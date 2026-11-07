/**
 * Asymmetric key generation and export via WebCrypto.
 *
 * A generated pair is exported in three shapes, because each is consumed by a
 * different thing:
 *   - PKCS#8 / SPKI PEM — OpenSSL and most libraries.
 *   - OpenSSH public key — the single line you paste into `authorized_keys`.
 *   - OpenSSH private key — the `-----BEGIN OPENSSH PRIVATE KEY-----` blob that
 *     `ssh-keygen` writes (its own binary format, not PEM-wrapped DER).
 *
 * The OpenSSH shapes are derived from the PKCS#8/SPKI DER that WebCrypto
 * produced, so the key the user sees is the one source of truth and there is no
 * hand-rolled ASN.1 writing.
 */

export type Algorithm = 'RSA-2048' | 'RSA-4096' | 'ECDSA-P256' | 'ECDSA-P384' | 'Ed25519'

export interface KeyPair {
  algorithm: Algorithm
  /** `-----BEGIN PUBLIC KEY-----` (SPKI). */
  publicKeyPem: string
  /** `-----BEGIN PRIVATE KEY-----` (PKCS#8). */
  privateKeyPem: string
  /** `ssh-ed25519 AAAA…` — the line that goes in `authorized_keys`. */
  publicKeyOpenssh: string
  /** `SHA256:…`, exactly as `ssh-keygen -l` prints it. */
  fingerprint: string
  /** `ssh-ed25519`, `ssh-rsa` or `ecdsa-sha2-nistp256`. */
  keyType: string
  /** Human description, e.g. `RSA 2048-bit` or `ECDSA P-256`. */
  keySummary: string
  /** Modulus or curve size in bits. */
  bits: number
  /**
   * `-----BEGIN OPENSSH PRIVATE KEY-----`. Omitted for key types whose OpenSSH
   * private encoding is not produced here.
   */
  privateKeyOpenssh?: string
}

/** Thrown when key data is malformed or of a type this module does not know. */
export class KeyPairError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyPairError'
  }
}

/* -------------------------------------------------------------------------
   Bytes
   ------------------------------------------------------------------------- */

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function pemFromDer(der: Uint8Array, label: string): string {
  const lines = toBase64(der).match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

/** Split a PEM block into its label and DER bytes, or null if it is not one. */
export function parsePem(text: string): { label: string; der: Uint8Array } | null {
  const match = /-----BEGIN ([^-]+)-----\s*([\s\S]*?)\s*-----END \1-----/.exec(text.trim())
  if (!match) return null
  try {
    return { label: match[1].trim(), der: fromBase64(match[2].replace(/\s+/g, '')) }
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------
   Minimal DER reader
   ------------------------------------------------------------------------- */

class Der {
  private offset = 0

  constructor(readonly bytes: Uint8Array) {}

  private u8(): number {
    const value = this.bytes[this.offset]
    if (value === undefined) throw new KeyPairError('The key data ended unexpectedly.')
    this.offset += 1
    return value
  }

  private length(): number {
    const first = this.u8()
    if (first < 0x80) return first
    const count = first & 0x7f
    if (count === 0 || count > 4) throw new KeyPairError('The key data uses an unsupported length encoding.')
    let value = 0
    for (let i = 0; i < count; i += 1) value = value * 256 + this.u8()
    return value
  }

  /** Read one tagged value and return a reader over its contents. */
  next(tag: number): Der {
    const found = this.u8()
    if (found !== tag) {
      throw new KeyPairError(`The key data is not valid ASN.1 (expected tag ${tag}, found ${found}).`)
    }
    const size = this.length()
    if (this.offset + size > this.bytes.length) throw new KeyPairError('The key data is truncated.')
    const slice = this.bytes.subarray(this.offset, this.offset + size)
    this.offset += size
    return new Der(slice)
  }

  peek(): number {
    return this.bytes[this.offset]
  }

  /** Everything left in this reader, as raw bytes. */
  contents(): Uint8Array {
    return this.bytes.subarray(this.offset)
  }

  oid(): string {
    const inner = this.next(0x06).contents()
    const first = inner[0]
    const parts = [Math.floor(first / 40), first % 40]
    let value = 0
    for (let i = 1; i < inner.length; i += 1) {
      value = value * 128 + (inner[i] & 0x7f)
      if ((inner[i] & 0x80) === 0) {
        parts.push(value)
        value = 0
      }
    }
    return parts.join('.')
  }

  bitString(): Uint8Array {
    const inner = this.next(0x03)
    if (inner.u8() !== 0) throw new KeyPairError('The key data has an unexpected bit offset.')
    return inner.contents()
  }

  octetString(): Uint8Array {
    return this.next(0x04).contents()
  }

  /** Integer bytes, leading zero included, ready for `sshMpint`. */
  integer(): Uint8Array {
    return this.next(0x02).contents()
  }
}

function readAlgorithm(r: Der): { oid: string; curve?: string } {
  const inner = r.next(0x30)
  const oid = inner.oid()
  let curve: string | undefined
  if (inner.peek() === 0x06) curve = inner.oid()
  else if (inner.peek() === 0x05) inner.next(0x05) // NULL parameters, e.g. RSA
  return { oid, curve }
}

interface SpkiInfo {
  oid: string
  curve?: string
  /** The algorithm-specific public key bytes. */
  bits: Uint8Array
}

function readSpki(der: Uint8Array): SpkiInfo {
  const top = new Der(der).next(0x30)
  const { oid, curve } = readAlgorithm(top)
  return { oid, curve, bits: top.bitString() }
}

function readPkcs8(der: Uint8Array): { oid: string; curve?: string; inner: Uint8Array } {
  const top = new Der(der).next(0x30)
  top.integer() // version 0
  const { oid, curve } = readAlgorithm(top)
  return { oid, curve, inner: top.octetString() }
}

/* -------------------------------------------------------------------------
   Algorithm identifiers
   ------------------------------------------------------------------------- */

const OID_RSA = '1.2.840.113549.1.1.1'
const OID_EC = '1.2.840.10045.2.1'
const OID_ED25519 = '1.3.101.112'
const OID_ED448 = '1.3.101.113'

const CURVES: Record<string, { name: string; bits: number }> = {
  '1.2.840.10045.3.1.7': { name: 'nistp256', bits: 256 },
  '1.3.132.0.34': { name: 'nistp384', bits: 384 },
  '1.3.132.0.35': { name: 'nistp521', bits: 521 },
}

const UNSUPPORTED =
  'This key type is not supported. Export works for RSA, ECDSA (P-256, P-384, P-521) and Ed25519 keys.'

/* -------------------------------------------------------------------------
   OpenSSH wire encoding
   ------------------------------------------------------------------------- */

/** RFC 4251 `string`: a 4-byte big-endian length then the bytes. */
function sshString(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const head = new Uint8Array([
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ])
  return concat([head, bytes])
}

/** RFC 4251 `mpint`: a `string` holding a minimal, two's-complement integer. */
function sshMpint(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1
  let value = bytes.subarray(start)
  if (value.length === 0) value = new Uint8Array([0])
  if ((value[0] & 0x80) !== 0) value = concat([new Uint8Array([0]), value])
  return sshString(value)
}

interface SshPublic {
  type: string
  blob: Uint8Array
}

/** The type name and binary blob of the OpenSSH public key. */
export function opensshPublicParts(spkiDer: Uint8Array): SshPublic {
  const { oid, curve, bits } = readSpki(spkiDer)
  if (oid === OID_RSA) {
    const seq = new Der(bits).next(0x30)
    const n = seq.integer()
    const e = seq.integer()
    return { type: 'ssh-rsa', blob: concat([sshString(ascii('ssh-rsa')), sshMpint(e), sshMpint(n)]) }
  }
  if (oid === OID_ED25519) {
    return { type: 'ssh-ed25519', blob: concat([sshString(ascii('ssh-ed25519')), sshString(bits)]) }
  }
  if (oid === OID_ED448) {
    return { type: 'ssh-ed448', blob: concat([sshString(ascii('ssh-ed448')), sshString(bits)]) }
  }
  if (oid === OID_EC) {
    const entry = curve ? CURVES[curve] : undefined
    if (!entry) throw new KeyPairError(`The elliptic curve (${curve ?? 'unknown'}) is not supported.`)
    const type = `ecdsa-sha2-${entry.name}`
    return { type, blob: concat([sshString(ascii(type)), sshString(ascii(entry.name)), sshString(bits)]) }
  }
  throw new KeyPairError(UNSUPPORTED)
}

/** The full `authorized_keys` line: type, base64 blob, no trailing newline. */
export function opensshPublicKey(spkiDer: Uint8Array): string {
  const { type, blob } = opensshPublicParts(spkiDer)
  return `${type} ${toBase64(blob)}`
}

/** Modulus or curve size in bits. */
export function keyBits(spkiDer: Uint8Array): number {
  const { oid, curve, bits } = readSpki(spkiDer)
  if (oid === OID_RSA) {
    const seq = new Der(bits).next(0x30)
    const n = seq.integer()
    return (n.length - (n[0] === 0 ? 1 : 0)) * 8
  }
  if (oid === OID_ED25519) return 256
  if (oid === OID_ED448) return 456
  if (oid === OID_EC) {
    const entry = curve ? CURVES[curve] : undefined
    if (!entry) throw new KeyPairError(UNSUPPORTED)
    return entry.bits
  }
  throw new KeyPairError(UNSUPPORTED)
}

/** A short plain-language description, e.g. `RSA 2048-bit` or `ECDSA P-256`. */
export function keySummary(spkiDer: Uint8Array): string {
  const { oid } = readSpki(spkiDer)
  if (oid === OID_RSA) return `RSA ${keyBits(spkiDer)}-bit`
  if (oid === OID_ED25519) return 'Ed25519'
  if (oid === OID_ED448) return 'Ed448'
  if (oid === OID_EC) return `ECDSA P-${keyBits(spkiDer)}`
  throw new KeyPairError(UNSUPPORTED)
}

/** `SHA256:…` fingerprint of the OpenSSH blob, matching `ssh-keygen -l -f`. */
export async function opensshFingerprint(spkiDer: Uint8Array): Promise<string> {
  const { blob } = opensshPublicParts(spkiDer)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(blob)))
  return `SHA256:${toBase64(digest).replace(/=+$/, '')}`
}

/* -------------------------------------------------------------------------
   OpenSSH private key
   ------------------------------------------------------------------------- */

const OPENSSH_MAGIC = ascii('openssh-key-v1\0')

interface PrivateParts {
  keyType: string
  /** The key-type-specific private fields, in OpenSSH order. */
  fields: Uint8Array[]
  /**
   * For Ed25519/Ed448 the private fields need the public key too, so the seed
   * is kept aside until the SPKI has been read.
   */
  seed?: Uint8Array
}

function opensshPrivateParts(pkcs8Der: Uint8Array, spkiDer: Uint8Array): PrivateParts | null {
  const priv = readPkcs8(pkcs8Der)
  const { bits } = readSpki(spkiDer)

  if (priv.oid === OID_ED25519 || priv.oid === OID_ED448) {
    // PKCS#8 wraps the raw seed in a nested OCTET STRING.
    const seed = new Der(priv.inner).octetString()
    return { keyType: priv.oid === OID_ED25519 ? 'ssh-ed25519' : 'ssh-ed448', fields: [], seed }
  }

  if (priv.oid === OID_RSA) {
    const seq = new Der(priv.inner).next(0x30)
    seq.integer() // version 0
    const n = seq.integer()
    const e = seq.integer()
    const d = seq.integer()
    const p = seq.integer()
    const q = seq.integer()
    seq.integer() // d mod (p-1) — not stored by OpenSSH
    seq.integer() // d mod (q-1) — not stored by OpenSSH
    const iqmp = seq.integer() // q^-1 mod p, which OpenSSH stores before p and q
    return {
      keyType: 'ssh-rsa',
      fields: [sshMpint(n), sshMpint(e), sshMpint(d), sshMpint(iqmp), sshMpint(p), sshMpint(q)],
    }
  }

  if (priv.oid === OID_EC) {
    const entry = priv.curve ? CURVES[priv.curve] : undefined
    if (!entry) return null
    // PKCS#8 wraps an RFC 5915 ECPrivateKey: SEQUENCE { version, privateKey }.
    const ec = new Der(priv.inner).next(0x30)
    ec.integer()
    const scalar = ec.octetString()
    return {
      keyType: `ecdsa-sha2-${entry.name}`,
      fields: [sshString(ascii(entry.name)), sshString(bits), sshMpint(scalar)],
    }
  }

  return null
}

/**
 * Build the `-----BEGIN OPENSSH PRIVATE KEY-----` file.
 *
 * Returns null for key types with no OpenSSH private encoding here, so callers
 * can hide the block rather than offer a file that will not load.
 */
export function opensshPrivateKey(pkcs8Der: Uint8Array, spkiDer: Uint8Array, comment = ''): string | null {
  const parts = opensshPrivateParts(pkcs8Der, spkiDer)
  if (!parts) return null

  let fields = parts.fields
  if (parts.seed) {
    const publicBytes = readSpki(spkiDer).bits
    if (publicBytes.length !== parts.seed.length) return null
    // OpenSSH stores the public key on its own and again inside the private
    // field, which is the seed followed by the public key.
    fields = [sshString(publicBytes), sshString(concat([parts.seed, publicBytes]))]
  }

  // OpenSSH writes the same random 4 bytes twice so a wrong passphrase or a
  // damaged file is detected on load.
  const check = new Uint8Array(4)
  crypto.getRandomValues(check)

  const body = concat([check, check, sshString(ascii(parts.keyType)), ...fields, sshString(ascii(comment))])
  const padding = (8 - (body.length % 8)) % 8
  const pad = new Uint8Array(padding)
  for (let i = 0; i < padding; i += 1) pad[i] = i + 1

  const file = concat([
    OPENSSH_MAGIC,
    sshString(ascii('none')), // cipher
    sshString(ascii('none')), // kdf
    sshString(new Uint8Array(0)), // kdf options
    new Uint8Array([0, 0, 0, 1]), // one key
    sshString(opensshPublicParts(spkiDer).blob),
    sshString(concat([body, pad])),
  ])
  return pemFromDer(file, 'OPENSSH PRIVATE KEY')
}

/* -------------------------------------------------------------------------
   Generation
   ------------------------------------------------------------------------- */

function params(algorithm: Algorithm): { gen: RsaHashedKeyGenParams | EcKeyGenParams | { name: string }; usages: KeyUsage[] } {
  switch (algorithm) {
    case 'RSA-2048':
    case 'RSA-4096':
      return {
        gen: {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: algorithm === 'RSA-2048' ? 2048 : 4096,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        usages: ['sign', 'verify'],
      }
    case 'ECDSA-P256':
    case 'ECDSA-P384':
      return {
        gen: { name: 'ECDSA', namedCurve: algorithm === 'ECDSA-P256' ? 'P-256' : 'P-384' },
        usages: ['sign', 'verify'],
      }
    case 'Ed25519':
      return { gen: { name: 'Ed25519' }, usages: ['sign', 'verify'] }
  }
}

export async function generateKeyPair(algorithm: Algorithm): Promise<KeyPair> {
  const { gen, usages } = params(algorithm)
  const pair = (await crypto.subtle.generateKey(gen as AlgorithmIdentifier, true, usages)) as CryptoKeyPair

  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))

  return {
    algorithm,
    publicKeyPem: pemFromDer(spki, 'PUBLIC KEY'),
    privateKeyPem: pemFromDer(pkcs8, 'PRIVATE KEY'),
    publicKeyOpenssh: opensshPublicKey(spki),
    fingerprint: await opensshFingerprint(spki),
    keyType: opensshPublicParts(spki).type,
    keySummary: keySummary(spki),
    bits: keyBits(spki),
    privateKeyOpenssh: opensshPrivateKey(pkcs8, spki) ?? undefined,
  }
}

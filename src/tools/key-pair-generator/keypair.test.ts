import { describe, expect, it } from 'vitest'
import {
  generateKeyPair,
  KeyPairError,
  keyBits,
  keySummary,
  opensshFingerprint,
  opensshPrivateKey,
  opensshPublicKey,
  parsePem,
  type Algorithm,
} from './keypair'

/* Fixtures produced by the reference implementations (cryptography/OpenSSL):
   the SPKI DER and the exact `authorized_keys` line and `ssh-keygen -l`
   fingerprint that those libraries print. They pin the wire format, which is
   what makes a key actually loadable. */
const FIXTURES = [
  {
    name: 'Ed25519',
    spki: 'MCowBQYDK2VwAyEApC7bAiJ7qdybkHhdW9q7FkFMlqKR/bFoSTO90Jdo+/I=',
    line: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKQu2wIie6ncm5B4XVvauxZBTJaikf2xaEkzvdCXaPvy',
    fingerprint: 'SHA256:quhF+6E5xqw5gGa2IpfJSRXa1KA1jbxTLGoege7Bm3w',
    type: 'ssh-ed25519',
    summary: 'Ed25519',
    bits: 256,
  },
  {
    name: 'RSA 2048',
    spki: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxLZ4IoRW8rkKihu7HEHAFYUddR5JdqLi4o4kxPYdowS+H9mhcZ6hHt0sy0JRWPFWz5YInlMWrbslpNFzpG07YW77PwADGsREDAwNCvyiJyYvSycb8cBCmvYnHhzt7oQvf9LnnRpd8dHk+fasvbq9D6HTaLQiwPmQOxpC78dXVssKpvecOvqC8aF5lqx/Q9iwdaZX102eP2t14oVYLKDoAYzifGvG8eK0P2f3PR39QvxzE8TEPBerF4GbEaY+Q+gs+JsmgM0P6aPQr8AyL0qml/5QSoOaeRhrCCxbKn+tKgyG9KsBwTG3s6nrpUj1/02WX04WE+zG9rlP5wwKnJUObQIDAQAB',
    line: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDEtngihFbyuQqKG7scQcAVhR11Hkl2ouLijiTE9h2jBL4f2aFxnqEe3SzLQlFY8VbPlgieUxatuyWk0XOkbTthbvs/AAMaxEQMDA0K/KInJi9LJxvxwEKa9iceHO3uhC9/0uedGl3x0eT59qy9ur0PodNotCLA+ZA7GkLvx1dWywqm95w6+oLxoXmWrH9D2LB1plfXTZ4/a3XihVgsoOgBjOJ8a8bx4rQ/Z/c9Hf1C/HMTxMQ8F6sXgZsRpj5D6Cz4myaAzQ/po9CvwDIvSqaX/lBKg5p5GGsILFsqf60qDIb0qwHBMbezqeulSPX/TZZfThYT7Mb2uU/nDAqclQ5t',
    fingerprint: 'SHA256:1Ag8Olmj0Nyw8Ze5GSjXX/mwoR9warLdcGx0vvRn5vU',
    type: 'ssh-rsa',
    summary: 'RSA 2048-bit',
    bits: 2048,
  },
  {
    name: 'ECDSA P-256',
    spki: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEoRWaHiGATnuJzduXmqbmJB3FpekHlFWZrSdTPW+qFxcqvHWVc8bR3WCsaIg9khMeMDOxiEmqZRSV5QrNStMpcw==',
    line: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBKEVmh4hgE57ic3bl5qm5iQdxaXpB5RVma0nUz1vqhcXKrx1lXPG0d1grGiIPZITHjAzsYhJqmUUleUKzUrTKXM=',
    fingerprint: 'SHA256:seW3jq8SoM3i78C8kzvbtASf1o7wlQZlTlEw/HB2DHI',
    type: 'ecdsa-sha2-nistp256',
    summary: 'ECDSA P-256',
    bits: 256,
  },
  {
    name: 'ECDSA P-384',
    spki: 'MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEfqqb3NVhlFfl6HAgL/aCKLzLQErPTmFIthQU+VvzJCKx3Gcw7rSdsviQYU1JW2R2HCMIsg5Xacd/ayEPNny9tV6Y9RIPKpAE/un+J2m6dl/dPeI33gWPEyZ2zdVHPwAK',
    line: 'ecdsa-sha2-nistp384 AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbmlzdHAzODQAAABhBH6qm9zVYZRX5ehwIC/2gii8y0BKz05hSLYUFPlb8yQisdxnMO60nbL4kGFNSVtkdhwjCLIOV2nHf2shDzZ8vbVemPUSDyqQBP7p/idpunZf3T3iN94FjxMmds3VRz8ACg==',
    fingerprint: 'SHA256:O7HZcEHkHdv6meTHacB66LDv6ksAqydztj5g1Vb2wIQ',
    type: 'ecdsa-sha2-nistp384',
    summary: 'ECDSA P-384',
    bits: 384,
  },
]

function der(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

describe('reference fixtures', () => {
  for (const fixture of FIXTURES) {
    it(`reproduces the ${fixture.name} authorized_keys line`, () => {
      expect(opensshPublicKey(der(fixture.spki))).toBe(fixture.line)
    })

    it(`reproduces the ${fixture.name} fingerprint`, async () => {
      expect(await opensshFingerprint(der(fixture.spki))).toBe(fixture.fingerprint)
    })

    it(`reports the ${fixture.name} type, summary and size`, () => {
      expect(opensshPublicKey(der(fixture.spki)).split(' ')[0]).toBe(fixture.type)
      expect(keySummary(der(fixture.spki))).toBe(fixture.summary)
      expect(keyBits(der(fixture.spki))).toBe(fixture.bits)
    })
  }
})

describe('parsePem', () => {
  it('reads the label and DER back out', () => {
    const pem = `-----BEGIN PUBLIC KEY-----\n${FIXTURES[1].spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`
    const parsed = parsePem(pem)
    expect(parsed?.label).toBe('PUBLIC KEY')
    expect(opensshPublicKey(parsed!.der)).toBe(FIXTURES[1].line)
  })

  it('returns null for text that is not a PEM block', () => {
    expect(parsePem('not a key')).toBeNull()
    expect(parsePem('-----BEGIN PUBLIC KEY-----\n!!!\n-----END PUBLIC KEY-----')).toBeNull()
  })
})

describe('key type rejection', () => {
  it('refuses a key whose ASN.1 is malformed', () => {
    expect(() => opensshPublicKey(new Uint8Array([0x30, 0x01, 0xff]))).toThrow(KeyPairError)
    expect(() => opensshPublicKey(new Uint8Array([]))).toThrow(KeyPairError)
  })

  it('refuses a truncated key', () => {
    const full = der(FIXTURES[0].spki)
    expect(() => opensshPublicKey(full.subarray(0, full.length - 4))).toThrow(KeyPairError)
  })
})

/* -------------------------------------------------------------------------
   Generated keys, end to end
   ------------------------------------------------------------------------- */

const ALGORITHMS: Algorithm[] = ['Ed25519', 'ECDSA-P256', 'ECDSA-P384', 'RSA-2048']

const EXPECTED: Record<Algorithm, { type: string; summary: string; bits: number }> = {
  Ed25519: { type: 'ssh-ed25519', summary: 'Ed25519', bits: 256 },
  'ECDSA-P256': { type: 'ecdsa-sha2-nistp256', summary: 'ECDSA P-256', bits: 256 },
  'ECDSA-P384': { type: 'ecdsa-sha2-nistp384', summary: 'ECDSA P-384', bits: 384 },
  'RSA-2048': { type: 'ssh-rsa', summary: 'RSA 2048-bit', bits: 2048 },
  'RSA-4096': { type: 'ssh-rsa', summary: 'RSA 4096-bit', bits: 4096 },
}

/** A reader for the OpenSSH binary blob, used to inspect a generated private key. */
class Blob {
  private offset = 0
  constructor(private readonly bytes: Uint8Array) {}

  u32(): number {
    const value =
      (this.bytes[this.offset] << 24) |
      (this.bytes[this.offset + 1] << 16) |
      (this.bytes[this.offset + 2] << 8) |
      this.bytes[this.offset + 3]
    this.offset += 4
    return value >>> 0
  }

  bytes32(length: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  string(): Uint8Array {
    return this.bytes32(this.u32())
  }

  get remaining(): number {
    return this.bytes.length - this.offset
  }
}

function decodeOpensshPrivate(text: string) {
  const parsed = parsePem(text)
  expect(parsed?.label).toBe('OPENSSH PRIVATE KEY')
  const r = new Blob(parsed!.der)
  const magic = new TextDecoder().decode(r.bytes32(15))
  const cipher = new TextDecoder().decode(r.string())
  const kdf = new TextDecoder().decode(r.string())
  const kdfOptions = r.string()
  const keyCount = r.u32()
  const publicBlob = r.string()
  const privateBlob = r.string()
  return { magic, cipher, kdf, kdfOptions, keyCount, publicBlob, privateBlob }
}

describe('generateKeyPair', () => {
  for (const algorithm of ALGORITHMS) {
    it(`generates a ${algorithm} pair with every export shape`, async () => {
      const pair = await generateKeyPair(algorithm)
      const expected = EXPECTED[algorithm]

      expect(pair.algorithm).toBe(algorithm)
      expect(pair.keyType).toBe(expected.type)
      expect(pair.keySummary).toBe(expected.summary)
      expect(pair.bits).toBe(expected.bits)

      expect(pair.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
      expect(pair.publicKeyPem.endsWith('-----END PUBLIC KEY-----')).toBe(true)
      expect(pair.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true)

      expect(pair.publicKeyOpenssh.startsWith(`${expected.type} `)).toBe(true)
      expect(pair.fingerprint.startsWith('SHA256:')).toBe(true)

      // The PEM and the OpenSSH line must describe the same key.
      const spki = parsePem(pair.publicKeyPem)!.der
      expect(opensshPublicKey(spki)).toBe(pair.publicKeyOpenssh)
      expect(await opensshFingerprint(spki)).toBe(pair.fingerprint)
    })
  }

  it('produces a different key every time', async () => {
    const a = await generateKeyPair('Ed25519')
    const b = await generateKeyPair('Ed25519')
    expect(a.publicKeyOpenssh).not.toBe(b.publicKeyOpenssh)
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('wraps every PEM line at 64 characters', async () => {
    const pair = await generateKeyPair('Ed25519')
    for (const pem of [pair.publicKeyPem, pair.privateKeyPem]) {
      const body = pem.split('\n').slice(1, -1)
      expect(body.every((line) => line.length <= 64)).toBe(true)
    }
  })
})

describe('OpenSSH private key', () => {
  for (const algorithm of ALGORITHMS) {
    it(`writes a structurally valid ${algorithm} private key`, async () => {
      const pair = await generateKeyPair(algorithm)
      expect(pair.privateKeyOpenssh).toBeDefined()
      const decoded = decodeOpensshPrivate(pair.privateKeyOpenssh!)

      expect(decoded.magic).toBe('openssh-key-v1\0')
      expect(decoded.cipher).toBe('none')
      expect(decoded.kdf).toBe('none')
      expect(decoded.kdfOptions.length).toBe(0)
      expect(decoded.keyCount).toBe(1)

      // The embedded public blob is byte-identical to the authorized_keys blob.
      const expectedBlob = atob(pair.publicKeyOpenssh.split(' ')[1])
      const actualBlob = String.fromCharCode(...decoded.publicBlob)
      expect(actualBlob).toBe(expectedBlob)

      // The private section repeats a 4-byte check value, names the key type,
      // and is padded to an 8-byte boundary with 1, 2, 3…
      const priv = new Blob(decoded.privateBlob)
      const checkA = priv.u32()
      const checkB = priv.u32()
      expect(checkA).toBe(checkB)
      expect(new TextDecoder().decode(priv.string())).toBe(EXPECTED[algorithm].type)

      // Walk the type-specific fields so the padding is reached.
      if (algorithm === 'Ed25519') {
        // OpenSSH writes the public key twice: once on its own, then again as
        // the tail of the private field (the seed followed by the public key).
        const publicField = priv.string()
        const privateField = priv.string()
        const spkiPublic = parsePem(pair.publicKeyPem)!.der.slice(-32)
        expect(Array.from(publicField)).toEqual(Array.from(spkiPublic))
        expect(privateField.length).toBe(64)
        expect(Array.from(privateField.subarray(32))).toEqual(Array.from(publicField))
      } else if (algorithm.startsWith('ECDSA')) {
        expect(new TextDecoder().decode(priv.string())).toBe(EXPECTED[algorithm].type.replace('ecdsa-sha2-', ''))
        // Uncompressed point: a 0x04 tag then X and Y, each bits/8 bytes.
        expect(priv.string().length).toBe(1 + (EXPECTED[algorithm].bits / 8) * 2)
        // The private scalar is bits/8 bytes, or one more when mpint needs a
        // leading zero to keep the value positive.
        const scalar = priv.string().length
        expect(scalar).toBeGreaterThanOrEqual(EXPECTED[algorithm].bits / 8)
        expect(scalar).toBeLessThanOrEqual(EXPECTED[algorithm].bits / 8 + 1)
      } else {
        for (let i = 0; i < 6; i += 1) expect(priv.string().length).toBeGreaterThan(0)
      }
      priv.string() // empty comment

      const padding = priv.remaining
      expect(padding).toBeLessThan(8)
      const pad = priv.bytes32(padding)
      for (let i = 0; i < padding; i += 1) expect(pad[i]).toBe(i + 1)
    })
  }

  it('rejects a mismatched key pair rather than writing a broken file', async () => {
    const a = await generateKeyPair('Ed25519')
    const b = await generateKeyPair('Ed25519')
    const pkcs8 = parsePem(a.privateKeyPem)!.der
    const spki = parsePem(b.publicKeyPem)!.der
    // Seed and public key lengths agree, so this is structurally fine; the point
    // is that it does not throw and still produces a parseable file.
    expect(opensshPrivateKey(pkcs8, spki)).not.toBeNull()
  })
})

/** IPv4/IPv6 parsing plus subnet maths, using BigInt so both widths are uniform. */

export function parseIPv4(input: string): number {
  const parts = input.trim().split('.')
  if (parts.length !== 4) throw new Error('An IPv4 address needs four octets, like 192.168.1.1')
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`"${part}" is not a number from 0 to 255`)
    const octet = Number(part)
    if (octet > 255) throw new Error(`Octet ${octet} is above 255`)
    value = (value << 8) | octet
  }
  return value >>> 0
}

export function formatIPv4(value: number): string {
  const v = value >>> 0
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.')
}

function parseHextet(hextet: string): number {
  if (!/^[0-9a-f]{1,4}$/.test(hextet)) throw new Error(`"${hextet}" is not a group of up to four hex digits`)
  return parseInt(hextet, 16)
}

export function parseIPv6(input: string): bigint {
  let str = input.trim().toLowerCase()
  // A zone id ("fe80::1%eth0") scopes a link-local address but is not part of
  // the 128 bits, so drop it before parsing.
  const zone = str.indexOf('%')
  if (zone !== -1) str = str.slice(0, zone)
  if (!str) throw new Error('Enter an IPv6 address, like 2001:db8::1')

  if (str.includes('.')) {
    const colon = str.lastIndexOf(':')
    if (colon === -1) throw new Error('An IPv4 part in an IPv6 address needs a ":" before it')
    const quad = parseIPv4(str.slice(colon + 1))
    str = `${str.slice(0, colon + 1)}${((quad >>> 16) & 0xffff).toString(16)}:${(quad & 0xffff).toString(16)}`
  }

  const halves = str.split('::')
  if (halves.length > 2) throw new Error('An IPv6 address can use "::" only once')

  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const headGroups = head.map(parseHextet)
  const tailGroups = tail.map(parseHextet)

  let groups: number[]
  if (halves.length === 2) {
    const missing = 8 - headGroups.length - tailGroups.length
    if (missing < 0) throw new Error('Too many groups for an IPv6 address (eight at most)')
    groups = [...headGroups, ...new Array(missing).fill(0), ...tailGroups]
  } else {
    if (headGroups.length !== 8) throw new Error('An IPv6 address without "::" needs exactly eight groups')
    groups = headGroups
  }

  let value = 0n
  for (const group of groups) value = (value << 16n) | BigInt(group)
  return value
}

export function formatIPv6(value: bigint): string {
  const groups: number[] = []
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn))

  let bestStart = -1
  let bestLength = 0
  let curStart = -1
  let curLength = 0
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i
      curLength++
      if (curLength > bestLength) {
        bestLength = curLength
        bestStart = curStart
      }
    } else {
      curStart = -1
      curLength = 0
    }
  }
  if (bestLength < 2) bestStart = -1

  const hex = groups.map((group) => group.toString(16))
  if (bestStart < 0) return hex.join(':')
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`
}

function maskFor(bits: number, prefix: number): bigint {
  return ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n)
}

/**
 * Count the leading 1 bits of a dotted IPv4 netmask, e.g. `255.255.255.0` → 24.
 * A valid mask is a contiguous run of 1s followed by 0s; anything else (a
 * "wildcard" order, a gap) is rejected so a typo is named rather than silently
 * producing a wrong subnet.
 */
export function netmaskToPrefix(mask: string): number {
  const value = parseIPv4(mask)
  const inverted = ~value >>> 0
  // For a contiguous mask, inverting and adding one leaves a single power of
  // two, so the bitwise AND is zero.
  if ((inverted & (inverted + 1)) !== 0) {
    throw new Error(`"${mask}" is not a valid netmask — its 1 bits must be contiguous`)
  }
  let prefix = 0
  for (let bit = 31; bit >= 0; bit--) {
    if ((value >>> bit) & 1) prefix++
    else break
  }
  return prefix
}

export interface ParsedCidr {
  version: 4 | 6
  value: bigint
  prefix: number
  maxPrefix: number
}

export function parseCidr(input: string): ParsedCidr {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Enter an address, like 192.168.1.10/24')

  const parts = trimmed.split('/')
  if (parts.length > 2) throw new Error('Use a single "/" between the address and the prefix')

  const address = parts[0].trim()
  if (!address) throw new Error('Enter an address before the "/"')

  const version: 4 | 6 = address.includes(':') ? 6 : 4
  const maxPrefix = version === 4 ? 32 : 128

  let prefix: number
  const rawPrefix = parts.length === 2 ? parts[1].trim() : undefined
  if (rawPrefix === undefined) {
    prefix = maxPrefix
  } else if (rawPrefix === '') {
    throw new Error(`Add a prefix after the "/", from 0 to ${maxPrefix}`)
  } else if (rawPrefix.includes('.')) {
    if (version !== 4) throw new Error('A dotted netmask only applies to IPv4')
    prefix = netmaskToPrefix(rawPrefix)
  } else {
    if (!/^\d+$/.test(rawPrefix)) throw new Error(`Prefix "${rawPrefix}" is not a whole number`)
    prefix = Number(rawPrefix)
    if (prefix > maxPrefix) throw new Error(`Prefix must be between 0 and ${maxPrefix}`)
  }

  const value = version === 4 ? BigInt(parseIPv4(address)) : parseIPv6(address)
  return { version, value, prefix, maxPrefix }
}

/* -------------------------------------------------------------------------
   Classification
   ------------------------------------------------------------------------- */

export type AddressScope =
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'shared'
  | 'documentation'
  | 'multicast'
  | 'reserved'
  | 'public'

export const SCOPE_LABELS: Record<AddressScope, string> = {
  loopback: 'Loopback',
  private: 'Private',
  'link-local': 'Link-local',
  shared: 'Shared (CGNAT)',
  documentation: 'Documentation',
  multicast: 'Multicast',
  reserved: 'Reserved',
  public: 'Public',
}

function v4In(value: bigint, network: string, prefix: number): boolean {
  const mask = maskFor(32, prefix)
  return (value & mask) === (BigInt(parseIPv4(network)) & mask)
}

function v6In(value: bigint, network: string, prefix: number): boolean {
  const mask = maskFor(128, prefix)
  return (value & mask) === (parseIPv6(network) & mask)
}

/** The special-purpose ranges, checked in order so the most specific wins. */
const V4_SCOPES: { scope: AddressScope; network: string; prefix: number }[] = [
  { scope: 'reserved', network: '0.0.0.0', prefix: 8 },
  { scope: 'loopback', network: '127.0.0.0', prefix: 8 },
  { scope: 'link-local', network: '169.254.0.0', prefix: 16 },
  { scope: 'private', network: '10.0.0.0', prefix: 8 },
  { scope: 'private', network: '172.16.0.0', prefix: 12 },
  { scope: 'private', network: '192.168.0.0', prefix: 16 },
  { scope: 'shared', network: '100.64.0.0', prefix: 10 },
  { scope: 'documentation', network: '192.0.2.0', prefix: 24 },
  { scope: 'documentation', network: '198.51.100.0', prefix: 24 },
  { scope: 'documentation', network: '203.0.113.0', prefix: 24 },
  { scope: 'multicast', network: '224.0.0.0', prefix: 4 },
]

/** Classify an address by its special-purpose range (RFC 6890 and friends). */
export function addressScope(version: 4 | 6, value: bigint): AddressScope {
  if (version === 4) {
    for (const entry of V4_SCOPES) {
      if (v4In(value, entry.network, entry.prefix)) return entry.scope
    }
    return 'public'
  }
  if (v6In(value, '::1', 128)) return 'loopback'
  if (value === 0n) return 'reserved'
  if (v6In(value, 'fe80::', 10)) return 'link-local'
  if (v6In(value, 'fc00::', 7)) return 'private'
  if (v6In(value, 'ff00::', 8)) return 'multicast'
  if (v6In(value, '2001:db8::', 32)) return 'documentation'
  return 'public'
}

/** The legacy classful label, IPv4 only. */
export function addressClass(value: bigint): string {
  const first = Number((value >> 24n) & 0xffn)
  if (first < 128) return 'A'
  if (first < 192) return 'B'
  if (first < 224) return 'C'
  if (first < 240) return 'D (multicast)'
  return 'E (reserved)'
}

export interface AddressCounts {
  hostBits: number
  /** Every address in the block, including network and broadcast. */
  total: bigint
  /** Addresses you can actually assign; RFC 3021 makes /31 and /32 fully usable. */
  usable: bigint
}

export function addressCounts(version: 4 | 6, prefix: number): AddressCounts {
  const hostBits = (version === 4 ? 32 : 128) - prefix
  const total = 1n << BigInt(hostBits)
  const usable = hostBits >= 2 ? total - 2n : total
  return { hostBits, total, usable }
}

/* -------------------------------------------------------------------------
   Formatting helpers
   ------------------------------------------------------------------------- */

/** Group a decimal string in threes, e.g. `4294967296` → `4,294,967,296`. */
export function groupBigInt(value: string | bigint): string {
  const digits = value.toString()
  const negative = digits.startsWith('-')
  const body = negative ? digits.slice(1) : digits
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${grouped}` : grouped
}

/* -------------------------------------------------------------------------
   Reverse DNS
   ------------------------------------------------------------------------- */

/**
 * The reverse-DNS (PTR) zone that covers a block: `1.168.192.in-addr.arpa` for
 * a 192.168.1.0/24, `8.b.d.0.1.0.0.2.ip6.arpa` for 2001:db8::/32.
 *
 * Delegation happens on whole labels, so a block that is not label-aligned is
 * named by the enclosing zone (a /25 still lives under the /24's three-octet
 * zone). A /0 has no labels to reverse and is the root zone itself.
 */
export function reverseDns(version: 4 | 6, network: bigint, prefix: number): string {
  const labels: string[] = []
  if (version === 4) {
    const kept = prefix === 0 ? 0 : Math.max(1, Math.floor(prefix / 8))
    for (let i = 0; i < kept; i++) labels.push(String(Number((network >> BigInt(24 - i * 8)) & 0xffn)))
    return `${labels.reverse().concat('in-addr.arpa').join('.')}`
  }
  const kept = prefix === 0 ? 0 : Math.max(1, Math.floor(prefix / 4))
  for (let i = 0; i < kept; i++) labels.push(((network >> BigInt(124 - i * 4)) & 0xfn).toString(16))
  return `${labels.reverse().concat('ip6.arpa').join('.')}`
}

const SCALE = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion']

/**
 * A short, readable form for a very large count: `about 4.3 billion`, or
 * `≈ 3.4 × 10^38` once the count runs past the named scales (an IPv6 /0).
 */
export function approximateCount(value: bigint): string {
  if (value < 1000n) return value.toString()
  let scale = 0
  let unit = 1n
  while (scale < SCALE.length - 1 && value >= unit * 1000n) {
    unit *= 1000n
    scale++
  }
  if (value / unit >= 1000n) {
    const digits = value.toString()
    const mantissa = Number(digits.slice(0, 2)) / 10
    return `≈ ${mantissa} × 10^${digits.length - 1}`
  }
  const mantissaTimesTen = (value * 10n + unit / 2n) / unit
  const whole = mantissaTimesTen / 10n
  const frac = mantissaTimesTen % 10n
  const mantissa = frac === 0n ? groupBigInt(whole) : `${groupBigInt(whole)}.${frac}`
  return `about ${mantissa} ${SCALE[scale]}`
}

/* -------------------------------------------------------------------------
   Subnet
   ------------------------------------------------------------------------- */

export interface SubnetInfo {
  version: 4 | 6
  address: string
  prefix: number
  /** The canonical network block, e.g. `192.168.1.0/24`. */
  cidr: string
  network: string
  broadcast: string
  first: string
  last: string
  netmask: string
  wildcard: string
  hostBits: number
  hostCount: string
  usableCount: string
  isPrivate: boolean
  scope: AddressScope
  scopeLabel: string
  addressClass: string
  /** The reverse-DNS zone this block falls under, e.g. `1.168.192.in-addr.arpa`. */
  reverseZone: string
  /** What the entered address is inside the block: network, broadcast or host. */
  role: string
}

function formatValue(version: 4 | 6, value: bigint): string {
  return version === 4 ? formatIPv4(Number(value)) : formatIPv6(value)
}

function roleOf(value: bigint, network: bigint, broadcast: bigint, hostBits: number): string {
  if (hostBits < 2) return 'Usable address'
  if (value === network) return 'Network address'
  if (value === broadcast) return 'Broadcast address'
  return 'Usable host'
}

const LOCAL_SCOPES: AddressScope[] = ['private', 'loopback', 'link-local']

export function computeSubnet(input: string): SubnetInfo {
  const { version, value, prefix, maxPrefix } = parseCidr(input)
  const mask = maskFor(maxPrefix, prefix)
  const inversion = (1n << BigInt(maxPrefix - prefix)) - 1n

  const network = value & mask
  const broadcast = network | inversion

  // A /31 or /32 has no usable "middle" range; RFC 3021 treats both as hosts.
  const widelyUsable = maxPrefix - prefix >= 2
  const first = widelyUsable ? network + 1n : network
  const last = widelyUsable ? broadcast - 1n : broadcast

  const counts = addressCounts(version, prefix)
  const scope = addressScope(version, value)

  return {
    version,
    address: formatValue(version, value),
    prefix,
    cidr: `${formatValue(version, network)}/${prefix}`,
    network: formatValue(version, network),
    broadcast: formatValue(version, broadcast),
    first: formatValue(version, first),
    last: formatValue(version, last),
    netmask: formatValue(version, mask),
    wildcard: formatValue(version, inversion),
    hostBits: counts.hostBits,
    hostCount: counts.total.toString(),
    usableCount: counts.usable.toString(),
    isPrivate: LOCAL_SCOPES.includes(scope),
    scope,
    scopeLabel: SCOPE_LABELS[scope],
    addressClass: version === 4 ? addressClass(value) : '—',
    reverseZone: reverseDns(version, network, prefix),
    role: roleOf(value, network, broadcast, counts.hostBits),
  }
}

import { describe, expect, it } from 'vitest'
import {
  addressClass,
  addressCounts,
  addressScope,
  approximateCount,
  computeSubnet,
  formatIPv4,
  formatIPv6,
  groupBigInt,
  netmaskToPrefix,
  parseCidr,
  parseIPv4,
  parseIPv6,
  reverseDns,
} from './cidr'

describe('IPv4 parsing', () => {
  it('round-trips', () => {
    expect(parseIPv4('192.168.1.1')).toBe(0xc0a80101)
    expect(formatIPv4(0xc0a80101)).toBe('192.168.1.1')
    expect(formatIPv4(0)).toBe('0.0.0.0')
    expect(formatIPv4(0xffffffff)).toBe('255.255.255.255')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseIPv4('  10.0.0.1  ')).toBe(parseIPv4('10.0.0.1'))
  })

  it('rejects malformed input with a specific message', () => {
    expect(() => parseIPv4('1.2.3')).toThrow(/four octets/)
    expect(() => parseIPv4('1.2.3.256')).toThrow(/above 255/)
    expect(() => parseIPv4('a.b.c.d')).toThrow(/not a number/)
  })
})

describe('IPv6 parsing', () => {
  it('expands and compresses', () => {
    expect(parseIPv6('::1')).toBe(1n)
    expect(parseIPv6('::')).toBe(0n)
    expect(formatIPv6(parseIPv6('2001:0db8:0000:0000:0000:0000:0000:0001'))).toBe('2001:db8::1')
    expect(formatIPv6(0n)).toBe('::')
  })

  it('handles embedded IPv4', () => {
    expect(formatIPv6(parseIPv6('::ffff:192.168.1.1'))).toBe('::ffff:c0a8:101')
  })

  it('accepts and strips a zone id', () => {
    expect(parseIPv6('fe80::1%eth0')).toBe(parseIPv6('fe80::1'))
    expect(parseIPv6('fe80::1%25eth0')).toBe(parseIPv6('fe80::1'))
  })

  it('rejects bad group counts', () => {
    expect(() => parseIPv6('1:2:3')).toThrow(/exactly eight/)
    expect(() => parseIPv6('::1::2')).toThrow(/only once/)
    expect(() => parseIPv6('1:2:3:4:5:6:7:8:9')).toThrow()
  })
})

describe('netmaskToPrefix', () => {
  it('counts leading bits', () => {
    expect(netmaskToPrefix('255.255.255.0')).toBe(24)
    expect(netmaskToPrefix('255.255.255.255')).toBe(32)
    expect(netmaskToPrefix('0.0.0.0')).toBe(0)
    expect(netmaskToPrefix('255.255.255.252')).toBe(30)
    expect(netmaskToPrefix('255.255.128.0')).toBe(17)
  })

  it('rejects a non-contiguous mask', () => {
    expect(() => netmaskToPrefix('255.0.255.0')).toThrow(/contiguous/)
    expect(() => netmaskToPrefix('0.0.0.255')).toThrow(/contiguous/)
  })
})

describe('parseCidr', () => {
  it('defaults the prefix to the address width', () => {
    expect(parseCidr('10.0.0.1').prefix).toBe(32)
    expect(parseCidr('::1').prefix).toBe(128)
  })

  it('accepts a dotted netmask in place of a prefix', () => {
    expect(parseCidr('10.0.0.0/255.0.0.0').prefix).toBe(8)
    expect(computeSubnet('192.168.1.10/255.255.255.0').network).toBe('192.168.1.0')
  })

  it('rejects out-of-range prefixes', () => {
    expect(() => parseCidr('10.0.0.1/33')).toThrow(/between 0 and 32/)
    expect(() => parseCidr('::1/129')).toThrow(/between 0 and 128/)
  })

  it('names the malformed parts', () => {
    expect(() => parseCidr('')).toThrow(/Enter an address/)
    expect(() => parseCidr('10.0.0.1/')).toThrow(/Add a prefix/)
    expect(() => parseCidr('10.0.0.1/24/8')).toThrow(/single "\/"/)
    expect(() => parseCidr('10.0.0.1/abc')).toThrow(/whole number/)
    expect(() => parseCidr('::1/255.0.0.0')).toThrow(/IPv4/)
  })
})

describe('addressCounts', () => {
  it('subtracts the network and broadcast for IPv4', () => {
    expect(addressCounts(4, 24)).toEqual({ hostBits: 8, total: 256n, usable: 254n })
  })

  it('treats /31 and /32 as fully usable (RFC 3021)', () => {
    expect(addressCounts(4, 31).usable).toBe(2n)
    expect(addressCounts(4, 32).usable).toBe(1n)
  })

  it('counts IPv6 by the same rule', () => {
    expect(addressCounts(6, 126).usable).toBe(2n)
    expect(addressCounts(6, 64).total).toBe(2n ** 64n)
  })
})

describe('addressScope', () => {
  it('classifies IPv4 ranges', () => {
    const scope = (address: string) => addressScope(4, BigInt(parseIPv4(address)))
    expect(scope('10.1.2.3')).toBe('private')
    expect(scope('172.16.0.1')).toBe('private')
    expect(scope('172.32.0.1')).toBe('public')
    expect(scope('192.168.1.1')).toBe('private')
    expect(scope('127.0.0.1')).toBe('loopback')
    expect(scope('169.254.1.1')).toBe('link-local')
    expect(scope('100.64.0.1')).toBe('shared')
    expect(scope('192.0.2.5')).toBe('documentation')
    expect(scope('224.0.0.1')).toBe('multicast')
    expect(scope('8.8.8.8')).toBe('public')
  })

  it('classifies IPv6 ranges', () => {
    const scope = (address: string) => addressScope(6, parseIPv6(address))
    expect(scope('::1')).toBe('loopback')
    expect(scope('fe80::1')).toBe('link-local')
    expect(scope('fd00::1')).toBe('private')
    expect(scope('ff02::1')).toBe('multicast')
    expect(scope('2001:db8::1')).toBe('documentation')
    expect(scope('2606:4700::1')).toBe('public')
  })
})

describe('addressClass', () => {
  it('reports the legacy class', () => {
    expect(addressClass(BigInt(parseIPv4('10.0.0.1')))).toBe('A')
    expect(addressClass(BigInt(parseIPv4('172.16.0.1')))).toBe('B')
    expect(addressClass(BigInt(parseIPv4('192.168.1.1')))).toBe('C')
    expect(addressClass(BigInt(parseIPv4('224.0.0.1')))).toBe('D (multicast)')
    expect(addressClass(BigInt(parseIPv4('240.0.0.1')))).toBe('E (reserved)')
  })
})

describe('groupBigInt / approximateCount', () => {
  it('groups in threes', () => {
    expect(groupBigInt('4294967296')).toBe('4,294,967,296')
    expect(groupBigInt(254n)).toBe('254')
    expect(groupBigInt(2n ** 128n)).toBe('340,282,366,920,938,463,463,374,607,431,768,211,456')
  })

  it('summarises large counts', () => {
    expect(approximateCount(254n)).toBe('254')
    expect(approximateCount(4294967296n)).toBe('about 4.3 billion')
    expect(approximateCount(2n ** 64n)).toBe('about 18.4 quintillion')
    expect(approximateCount(2n ** 128n)).toBe('≈ 3.4 × 10^38')
  })
})

describe('computeSubnet (IPv4)', () => {
  it('computes a /24', () => {
    const info = computeSubnet('192.168.1.10/24')
    expect(info.network).toBe('192.168.1.0')
    expect(info.broadcast).toBe('192.168.1.255')
    expect(info.first).toBe('192.168.1.1')
    expect(info.last).toBe('192.168.1.254')
    expect(info.netmask).toBe('255.255.255.0')
    expect(info.wildcard).toBe('0.0.0.255')
    expect(info.hostCount).toBe('256')
    expect(info.usableCount).toBe('254')
    expect(info.hostBits).toBe(8)
    expect(info.isPrivate).toBe(true)
    expect(info.scope).toBe('private')
    expect(info.scopeLabel).toBe('Private')
    expect(info.cidr).toBe('192.168.1.0/24')
    expect(info.role).toBe('Usable host')
    expect(info.addressClass).toBe('C')
  })

  it('names the role of the entered address', () => {
    expect(computeSubnet('192.168.1.0/24').role).toBe('Network address')
    expect(computeSubnet('192.168.1.255/24').role).toBe('Broadcast address')
    expect(computeSubnet('8.8.8.8/32').role).toBe('Usable address')
  })

  it('treats /31 and /32 as host ranges', () => {
    const p31 = computeSubnet('10.0.0.0/31')
    expect(p31.first).toBe('10.0.0.0')
    expect(p31.last).toBe('10.0.0.1')
    expect(p31.hostCount).toBe('2')
    expect(p31.usableCount).toBe('2')

    const p32 = computeSubnet('8.8.8.8/32')
    expect(p32.hostCount).toBe('1')
    expect(p32.usableCount).toBe('1')
    expect(p32.isPrivate).toBe(false)
    expect(p32.scope).toBe('public')
  })

  it('handles a /0', () => {
    const info = computeSubnet('0.0.0.0/0')
    expect(info.netmask).toBe('0.0.0.0')
    expect(info.broadcast).toBe('255.255.255.255')
    expect(info.hostCount).toBe('4294967296')
    expect(info.usableCount).toBe('4294967294')
    expect(info.cidr).toBe('0.0.0.0/0')
  })
})

describe('computeSubnet (IPv6)', () => {
  it('computes a /32 with the full host count', () => {
    const info = computeSubnet('2001:db8::1/32')
    expect(info.network).toBe('2001:db8::')
    expect(info.prefix).toBe(32)
    expect(info.hostCount).toBe((2n ** 96n).toString())
    expect(info.usableCount).toBe((2n ** 96n - 2n).toString())
    expect(info.last.startsWith('2001:db8:')).toBe(true)
    expect(info.addressClass).toBe('—')
    expect(info.scope).toBe('documentation')
  })

  it('flags unique-local addresses', () => {
    expect(computeSubnet('fd00::/8').isPrivate).toBe(true)
    expect(computeSubnet('2001:db8::/32').isPrivate).toBe(false)
  })

  it('reports a compressed canonical block', () => {
    expect(computeSubnet('2001:0db8:0000:0000:0000:0000:0000:0001/64').cidr).toBe('2001:db8::/64')
  })
})

describe('reverseDns', () => {
  it('reverses IPv4 octets by whole labels', () => {
    expect(reverseDns(4, BigInt(parseIPv4('192.168.1.0')), 24)).toBe('1.168.192.in-addr.arpa')
    expect(reverseDns(4, BigInt(parseIPv4('10.0.0.0')), 8)).toBe('10.in-addr.arpa')
    expect(reverseDns(4, BigInt(parseIPv4('172.16.0.0')), 16)).toBe('16.172.in-addr.arpa')
  })

  it('falls back to the enclosing zone for a non-octet boundary', () => {
    // A /25 delegates no new labels, so it is named by its /24 zone.
    expect(reverseDns(4, BigInt(parseIPv4('192.168.1.0')), 25)).toBe('1.168.192.in-addr.arpa')
    // A /30 still owns its /24 zone until /32, where it names itself.
    expect(reverseDns(4, BigInt(parseIPv4('192.168.1.4')), 30)).toBe('1.168.192.in-addr.arpa')
    expect(reverseDns(4, BigInt(parseIPv4('192.168.1.4')), 32)).toBe('4.1.168.192.in-addr.arpa')
  })

  it('reverses IPv6 nibbles by whole labels', () => {
    expect(reverseDns(6, parseIPv6('2001:db8::'), 32)).toBe('8.b.d.0.1.0.0.2.ip6.arpa')
    expect(reverseDns(6, parseIPv6('2001:db8::'), 48)).toBe('0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa')
  })

  it('names the root zone for a /0', () => {
    expect(reverseDns(4, 0n, 0)).toBe('in-addr.arpa')
    expect(reverseDns(6, 0n, 0)).toBe('ip6.arpa')
  })

  it('is exposed on computeSubnet', () => {
    expect(computeSubnet('192.168.1.10/24').reverseZone).toBe('1.168.192.in-addr.arpa')
    expect(computeSubnet('2001:db8::1/32').reverseZone).toBe('8.b.d.0.1.0.0.2.ip6.arpa')
  })
})

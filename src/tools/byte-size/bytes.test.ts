import { describe, expect, it } from 'vitest'
import { breakdown, ByteSizeError, decimalBinaryGap, formatBytes, parseBytes } from './bytes'

describe('formatBytes', () => {
  it('uses decimal units by default', () => {
    expect(formatBytes(1000)).toBe('1 kB')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(formatBytes(1_000_000_000)).toBe('1 GB')
  })

  it('uses binary units when asked', () => {
    expect(formatBytes(1024, { binary: true })).toBe('1 KiB')
    expect(formatBytes(1024 ** 2, { binary: true })).toBe('1 MiB')
    expect(formatBytes(1_000_000_000, { binary: true })).toBe('953.67 MiB')
  })

  it('never shows decimals for plain bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('groups thousands in the number', () => {
    expect(formatBytes(999_999)).toBe('1,000 kB')
    expect(formatBytes(123_456)).toBe('123.46 kB')
  })

  it('honours the decimal count', () => {
    expect(formatBytes(1234, { decimals: 0 })).toBe('1 kB')
    expect(formatBytes(1234, { decimals: 3 })).toBe('1.234 kB')
  })

  it('clamps a nonsensical decimal count instead of throwing', () => {
    expect(formatBytes(1234, { decimals: -5 })).toBe('1 kB')
    expect(formatBytes(1234, { decimals: 99 })).toBe('1.234 kB')
    expect(formatBytes(1234, { decimals: Number.NaN })).toBe('1.23 kB')
    expect(formatBytes(1234, { decimals: 2.7 })).toBe('1.23 kB')
  })

  it('pins a fixed unit', () => {
    expect(formatBytes(1024, { fixedUnit: 'kB', decimals: 3 })).toBe('1.024 kB')
    expect(formatBytes(1024, { fixedUnit: 'KiB', decimals: 3 })).toBe('1 KiB')
  })

  it('keeps the sign for negative values', () => {
    expect(formatBytes(-1500)).toBe('-1.5 kB')
  })

  it('never falls back to exponential notation', () => {
    expect(formatBytes(1e24)).toBe('1,000,000 EB')
    // `toFixed` switches to "1e+21" above 1e21; the formatter must not.
    const text = formatBytes(1e21, { fixedUnit: 'B' })
    expect(text).not.toContain('e')
    expect(text).toBe('1,000,000,000,000,000,000,000 B')
  })

  it('rejects non-finite input', () => {
    expect(() => formatBytes(Number.POSITIVE_INFINITY)).toThrow(ByteSizeError)
    expect(() => formatBytes(Number.NaN)).toThrow(ByteSizeError)
  })

  it('rejects an unknown fixed unit', () => {
    expect(() => formatBytes(1, { fixedUnit: 'XB' })).toThrow(ByteSizeError)
  })
})

describe('parseBytes', () => {
  it('reads a value with a unit', () => {
    expect(parseBytes('1.5 MB').bytes).toBe(1_500_000)
    expect(parseBytes('2GiB').bytes).toBe(2 * 1024 ** 3)
  })

  it('treats a bare number as bytes', () => {
    expect(parseBytes('512').bytes).toBe(512)
    expect(parseBytes('512').unit).toBe('b')
  })

  it('accepts several spellings', () => {
    expect(parseBytes('1k').bytes).toBe(1000)
    expect(parseBytes('1 kb').bytes).toBe(1000)
    expect(parseBytes('1 KiB').bytes).toBe(1024)
    expect(parseBytes('3 bytes').bytes).toBe(3)
    expect(parseBytes('2 megabytes').bytes).toBe(2_000_000)
    expect(parseBytes('2 mebibytes').bytes).toBe(2 * 1024 ** 2)
  })

  it('reads bits as an eighth of a byte', () => {
    expect(parseBytes('8 bits').bytes).toBe(1)
    expect(parseBytes('100 Mbit').bytes).toBe(12_500_000)
    expect(parseBytes('1 kibit').bytes).toBe(128)
  })

  it('accepts digit-group separators and refuses a decimal comma', () => {
    expect(parseBytes('4,294,967,296').bytes).toBe(4_294_967_296)
    expect(parseBytes('1_000 kB').bytes).toBe(1_000_000)
    expect(() => parseBytes('1,5 MB')).toThrow(ByteSizeError)
  })

  it('is case-insensitive and tolerates surrounding space', () => {
    expect(parseBytes('5 gb').bytes).toBe(parseBytes('5 GB').bytes)
    expect(parseBytes('  2 MB  ').bytes).toBe(2_000_000)
  })

  it('reports whether the byte count is exact', () => {
    expect(parseBytes('1 MB').exact).toBe(true)
    expect(parseBytes('1 bit').exact).toBe(false)
    expect(parseBytes('1 EB').exact).toBe(false)
  })

  it('rejects nonsense with a message that names the problem', () => {
    expect(() => parseBytes('')).toThrow(ByteSizeError)
    expect(() => parseBytes('abc')).toThrow(/Cannot read/)
    expect(() => parseBytes('1 xb')).toThrow(/Unknown unit "xb"/)
    expect(() => parseBytes('1,5 MB')).toThrow(ByteSizeError)
  })

  it('refuses a negative size instead of returning one', () => {
    expect(() => parseBytes('-1 MB')).toThrow(/negative/)
    expect(() => parseBytes('-1')).toThrow(/negative/)
  })

  it('refuses a size beyond what a double can hold', () => {
    expect(() => parseBytes('1e400')).toThrow(ByteSizeError)
  })

  it('round-trips through formatBytes', () => {
    const original = '1.5 MB'
    expect(formatBytes(parseBytes(original).bytes)).toBe(original)
  })
})

describe('breakdown', () => {
  it('lists the common representations', () => {
    const rows = breakdown(1024)
    expect(rows).toHaveLength(6)
    expect(rows.find((row) => row.label === 'Binary')?.value).toBe('1 KiB')
    expect(rows.find((row) => row.label === 'Bits')?.value).toBe('8,192 bit')
    expect(rows.find((row) => row.label === 'Bytes')?.value).toBe('1,024 B')
  })

  it('groups big byte counts', () => {
    expect(breakdown(4_294_967_296).find((row) => row.label === 'Bytes')?.value).toBe('4,294,967,296 B')
  })
})

describe('decimalBinaryGap', () => {
  it('is null when the scales agree', () => {
    expect(decimalBinaryGap(0)).toBeNull()
    expect(decimalBinaryGap(999)).toBeNull()
  })

  it('is the 1000-vs-1024 gap at each step', () => {
    expect(decimalBinaryGap(1000)).toBeCloseTo(1000 / 1024 * 100 - 100, 6)
    expect(decimalBinaryGap(1_000_000)).toBeCloseTo(((1000 / 1024) ** 2 - 1) * 100, 6)
    expect(decimalBinaryGap(1_000_000_000_000)).toBeCloseTo(((1000 / 1024) ** 4 - 1) * 100, 6)
  })

  it('treats a negative size by magnitude', () => {
    expect(decimalBinaryGap(-1_000_000)).toBeCloseTo(decimalBinaryGap(1_000_000)!, 6)
  })

  it('caps the step at the largest unit name', () => {
    expect(decimalBinaryGap(1e30)).toBeCloseTo(((1000 / 1024) ** 6 - 1) * 100, 6)
  })

  it('is null for non-finite input', () => {
    expect(decimalBinaryGap(Number.POSITIVE_INFINITY)).toBeNull()
    expect(decimalBinaryGap(Number.NaN)).toBeNull()
  })
})

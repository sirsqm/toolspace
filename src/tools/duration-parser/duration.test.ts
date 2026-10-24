import { describe, expect, it } from 'vitest'
import {
  DurationError,
  formatAmount,
  formatClock,
  formatDuration,
  largestUnit,
  parseDuration,
  parseIso,
  sumDurations,
  toIsoDuration,
} from './duration'

describe('parseDuration', () => {
  it('parses a single unit', () => {
    expect(parseDuration('90s')).toBe(90000)
    expect(parseDuration('2 hours')).toBe(7200000)
    expect(parseDuration('1d')).toBe(86400000)
  })

  it('parses combined units', () => {
    expect(parseDuration('1h30m')).toBe(5400000)
    expect(parseDuration('1h 30m 15s')).toBe(5415000)
    expect(parseDuration('2 days 4 hours')).toBe(187200000)
  })

  it('parses a bare number as seconds', () => {
    expect(parseDuration('45')).toBe(45000)
  })

  it('parses clock notation', () => {
    expect(parseDuration('01:30')).toBe(5400000)
    expect(parseDuration('1:30:15')).toBe(5415000)
    expect(parseDuration('0:00.500')).toBe(500)
  })

  it('is case-insensitive and ignores extra spaces', () => {
    expect(parseDuration('  1H 30M ')).toBe(5400000)
  })

  it('handles fractions', () => {
    expect(parseDuration('1.5h')).toBe(5400000)
  })

  it('rejects junk', () => {
    expect(() => parseDuration('')).toThrow(DurationError)
    expect(() => parseDuration('abc')).toThrow(DurationError)
    expect(() => parseDuration('1 fortnight')).toThrow(DurationError)
  })
})

describe('parseIso', () => {
  it('parses ISO-8601 durations', () => {
    expect(parseIso('PT1H30M')).toBe(5400000)
    expect(parseIso('P1D')).toBe(86400000)
    expect(parseIso('P1DT2H')).toBe(93600000)
    expect(parseIso('PT0.5S')).toBe(500)
  })

  it('is reached through parseDuration', () => {
    expect(parseDuration('P1W')).toBe(604800000)
  })

  it('rejects an empty duration', () => {
    expect(() => parseIso('P')).toThrow(DurationError)
    expect(() => parseIso('nonsense')).toThrow(DurationError)
  })
})

describe('formatDuration', () => {
  it('formats with short units', () => {
    expect(formatDuration(5400000)).toBe('1h 30m')
    expect(formatDuration(90000)).toBe('1m 30s')
  })

  it('formats with long units and singular agreement', () => {
    expect(formatDuration(5400000, { long: true })).toBe('1 hour 30 minutes')
    expect(formatDuration(1000, { long: true })).toBe('1 second')
  })

  it('can include milliseconds', () => {
    expect(formatDuration(1500, { millis: true })).toBe('1s 500ms')
    expect(formatDuration(1500, { long: true, millis: true })).toBe('1 second 500 milliseconds')
    expect(formatDuration(1000, { long: true, millis: true })).toBe('1 second')
    expect(formatDuration(500, { long: true, millis: true })).toBe('500 milliseconds')
  })

  it('can pad every unit', () => {
    expect(formatDuration(5400000, { pad: true })).toBe('0y 0mo 0w 0d 1h 30m 0s')
  })

  it('shows zero for nothing', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('marks negative durations', () => {
    expect(formatDuration(-5400000)).toBe('-1h 30m')
  })

  it('round-trips through parseDuration', () => {
    for (const ms of [0, 1000, 90000, 5400000, 86400000]) {
      expect(parseDuration(formatDuration(ms))).toBe(ms)
    }
  })
})

describe('formatClock', () => {
  it('omits hours when there are none', () => {
    expect(formatClock(90000)).toBe('01:30')
  })

  it('includes hours when present', () => {
    expect(formatClock(5415000)).toBe('01:30:15')
  })

  it('marks negative values', () => {
    expect(formatClock(-90000)).toBe('-01:30')
  })
})

describe('sumDurations', () => {
  it('adds values', () => {
    expect(sumDurations([1000, 2000, 3000])).toBe(6000)
    expect(sumDurations([])).toBe(0)
  })
})

describe('parseDuration sign handling', () => {
  it('accepts a leading minus or plus', () => {
    expect(parseDuration('-1h30m')).toBe(-5400000)
    expect(parseDuration('+45')).toBe(45000)
    expect(parseDuration('-2 days')).toBe(-172800000)
  })

  it('accepts the unicode minus a phone keyboard may send', () => {
    expect(parseDuration('−90s')).toBe(-90000)
  })

  it('rejects a bare sign', () => {
    expect(() => parseDuration('-')).toThrow(DurationError)
    expect(() => parseDuration('+')).toThrow(DurationError)
  })

  it('rejects a sign that is not at the front', () => {
    expect(() => parseDuration('1h-30m')).toThrow(DurationError)
  })
})

describe('clock validation', () => {
  it('rejects out-of-range minute and second fields', () => {
    expect(() => parseDuration('1:75')).toThrow(DurationError)
    expect(() => parseDuration('1:30:75')).toThrow(DurationError)
    expect(parseDuration('1:59')).toBe(7140000)
    expect(parseDuration('1:59:59')).toBe(7199000)
  })
})

describe('ISO-8601 variants', () => {
  it('accepts a comma as the decimal mark', () => {
    expect(parseIso('PT1,5H')).toBe(5400000)
    expect(parseDuration('pt0,5s')).toBe(500)
  })

  it('parses a full mixed duration', () => {
    expect(parseIso('P1Y2M3DT4H5M6S')).toBe(
      31557600000 + 2 * 2629800000 + 3 * 86400000 + 4 * 3600000 + 5 * 60000 + 6000,
    )
  })
})

describe('toIsoDuration', () => {
  it('writes hours, minutes and seconds', () => {
    expect(toIsoDuration(5400000)).toBe('PT1H30M')
    expect(toIsoDuration(90000)).toBe('PT1M30S')
    expect(toIsoDuration(5415000)).toBe('PT1H30M15S')
  })

  it('uses days as the largest unit', () => {
    expect(toIsoDuration(86400000)).toBe('P1D')
    expect(toIsoDuration(93600000)).toBe('P1DT2H')
  })

  it('keeps fractional seconds compact', () => {
    expect(toIsoDuration(1500)).toBe('PT1.5S')
    expect(toIsoDuration(500)).toBe('PT0.5S')
  })

  it('writes zero and negatives', () => {
    expect(toIsoDuration(0)).toBe('PT0S')
    expect(toIsoDuration(-5400000)).toBe('-PT1H30M')
  })

  it('round-trips through parseDuration', () => {
    for (const ms of [0, 500, 1500, 90000, 5400000, 93600000, 86400000]) {
      expect(parseDuration(toIsoDuration(ms))).toBe(ms)
    }
  })

  it('rejects non-finite input', () => {
    expect(() => toIsoDuration(Infinity)).toThrow(DurationError)
  })
})

describe('largestUnit', () => {
  it('picks the unit just below the value', () => {
    expect(largestUnit(5400000).short).toBe('h')
    expect(largestUnit(86400000).short).toBe('d')
    expect(largestUnit(90000).short).toBe('m')
    expect(largestUnit(500).short).toBe('ms')
  })

  it('handles zero and negatives', () => {
    expect(largestUnit(0).short).toBe('ms')
    expect(largestUnit(-604800000).short).toBe('w')
  })
})

describe('formatAmount', () => {
  it('keeps small results readable', () => {
    expect(formatAmount(0)).toBe('0')
    expect(formatAmount(1.5)).toBe('1.5')
    expect(formatAmount(5400)).toBe('5,400')
  })

  it('groups thousands and trims float noise', () => {
    expect(formatAmount(1234.56789)).toBe('1,234.57')
    expect(formatAmount(1 / 3)).toBe('0.333333')
  })

  it('falls back to exponent notation at the extremes', () => {
    expect(formatAmount(1e-7)).toBe('1.00e-7')
    expect(formatAmount(1e16)).toBe('1.00e+16')
  })

  it('reports non-finite values rather than printing NaN', () => {
    expect(formatAmount(Infinity)).toBe('∞')
    expect(formatAmount(-Infinity)).toBe('—')
    expect(formatAmount(NaN)).toBe('—')
  })
})

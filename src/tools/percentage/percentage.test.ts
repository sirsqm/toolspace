import { describe, expect, it } from 'vitest'
import {
  allocate,
  applyDiscount,
  applyMarkup,
  breakdownRows,
  describeChange,
  formatNumber,
  formatPercent,
  marginAndMarkup,
  parseList,
  parseNumber,
  PercentageError,
  percentBreakdown,
  percentChange,
  percentOf,
  percentOfTotal,
  reversePercent,
  round,
} from './percentage'

describe('percentOf', () => {
  it('computes a share of a value', () => {
    expect(percentOf(20, 150)).toBe(30)
    expect(percentOf(0, 150)).toBe(0)
    expect(percentOf(100, 42)).toBe(42)
  })

  it('accepts fractions and negatives', () => {
    expect(percentOf(12.5, 80)).toBe(10)
    expect(percentOf(-10, 200)).toBe(-20)
  })

  it('rejects non-numbers', () => {
    expect(() => percentOf(Number.NaN, 10)).toThrow(PercentageError)
    expect(() => percentOf(10, Number.POSITIVE_INFINITY)).toThrow(PercentageError)
  })
})

describe('percentOfTotal', () => {
  it('computes the share', () => {
    expect(percentOfTotal(25, 200)).toBe(12.5)
    expect(percentOfTotal(50, 50)).toBe(100)
  })

  it('rejects a zero total', () => {
    expect(() => percentOfTotal(5, 0)).toThrow(PercentageError)
  })
})

describe('percentChange', () => {
  it('reports an increase', () => {
    expect(percentChange(100, 150)).toBe(50)
  })

  it('reports a decrease', () => {
    expect(percentChange(100, 80)).toBe(-20)
  })

  it('measures against the size of a negative base', () => {
    // Going from -100 to -50 is a rise of half the original size, not a fall.
    expect(percentChange(-100, -50)).toBe(50)
    expect(percentChange(-100, -150)).toBe(-50)
  })

  it('rejects a zero base', () => {
    expect(() => percentChange(0, 10)).toThrow(PercentageError)
  })
})

describe('describeChange', () => {
  it('names the direction', () => {
    expect(describeChange(100, 150)).toEqual({ direction: 'increase', percent: 50 })
    expect(describeChange(100, 80)).toEqual({ direction: 'decrease', percent: -20 })
    expect(describeChange(100, 100)).toEqual({ direction: 'unchanged', percent: 0 })
  })

  it('refuses to invent a percentage from a zero base', () => {
    expect(describeChange(0, 10)).toEqual({ direction: 'from-zero', percent: null })
    expect(describeChange(0, 0)).toEqual({ direction: 'unchanged', percent: 0 })
  })
})

describe('reversePercent', () => {
  it('undoes a percentage change', () => {
    expect(reversePercent(150, 50)).toBe(100)
    expect(reversePercent(80, -20)).toBe(100)
  })

  it('rejects the impossible -100% case', () => {
    expect(() => reversePercent(50, -100)).toThrow(PercentageError)
  })
})

describe('applyDiscount / applyMarkup', () => {
  it('takes a percentage off', () => {
    expect(applyDiscount(200, 25)).toBe(150)
  })

  it('adds a percentage on', () => {
    expect(applyMarkup(80, 25)).toBe(100)
  })
})

describe('percentBreakdown', () => {
  it('turns weights into shares', () => {
    expect(percentBreakdown([1, 1, 2])).toEqual([25, 25, 50])
  })

  it('returns nothing for an empty list', () => {
    expect(percentBreakdown([])).toEqual([])
  })

  it('rejects a zero total and non-numbers', () => {
    expect(() => percentBreakdown([1, -1])).toThrow(PercentageError)
    expect(() => percentBreakdown([1, Number.NaN])).toThrow(PercentageError)
  })
})

describe('allocate', () => {
  it('splits a total so the parts add back up', () => {
    const parts = allocate(100, [1, 1, 1], 2)
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    expect(parts).toEqual([33.34, 33.33, 33.33])
  })

  it('never loses a penny on an awkward split', () => {
    const parts = allocate(10, [1, 1, 1], 2)
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10)
    expect(parts.map((p) => Math.round(p * 100)).reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('honours the requested precision', () => {
    const parts = allocate(1, [1, 1, 1], 0)
    expect(parts).toEqual([1, 0, 0])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('keeps the sign of a negative total', () => {
    const parts = allocate(-100, [1, 3], 2)
    expect(parts).toEqual([-25, -75])
  })

  it('gives everything to a single weight', () => {
    expect(allocate(50, [7], 2)).toEqual([50])
  })

  it('rejects negative weights and a zero sum', () => {
    expect(() => allocate(100, [1, -1])).toThrow(PercentageError)
    expect(() => allocate(100, [0, 0])).toThrow(PercentageError)
  })

  it('has nothing to split when there are no weights', () => {
    expect(allocate(100, [])).toEqual([])
  })
})

describe('breakdownRows', () => {
  it('pairs each weight with its share and amount', () => {
    const rows = breakdownRows(100, [1, 3], 2)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ index: 1, weight: 1, share: 25, amount: 25 })
    expect(rows[1]).toMatchObject({ index: 2, weight: 3, share: 75, amount: 75 })
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(100, 10)
  })

  it('returns nothing for no weights', () => {
    expect(breakdownRows(100, [])).toEqual([])
  })
})

describe('marginAndMarkup', () => {
  it('reports both figures', () => {
    const result = marginAndMarkup(80, 100)
    expect(result.margin).toBe(20)
    expect(result.markup).toBe(25)
  })

  it('rejects zero cost or price', () => {
    expect(() => marginAndMarkup(0, 100)).toThrow(PercentageError)
    expect(() => marginAndMarkup(80, 0)).toThrow(PercentageError)
  })
})

describe('round', () => {
  it('rounds to the requested precision', () => {
    expect(round(1.005, 2)).toBe(1.01)
    expect(round(2.675, 2)).toBe(2.68)
    expect(round(1234.5678, 3)).toBe(1234.568)
  })

  it('rejects non-finite input', () => {
    expect(() => round(Number.NaN)).toThrow(PercentageError)
  })
})

describe('parseNumber', () => {
  it('reads plain numbers', () => {
    expect(parseNumber('42')).toBe(42)
    expect(parseNumber('  42  ')).toBe(42)
    expect(parseNumber('-3.5')).toBe(-3.5)
    expect(parseNumber('.5')).toBe(0.5)
  })

  it('accepts what people paste', () => {
    expect(parseNumber('1,250')).toBe(1250)
    expect(parseNumber('1 250.75')).toBe(1250.75)
    expect(parseNumber('25%')).toBe(25)
    expect(parseNumber('1_000')).toBe(1000)
    expect(parseNumber('1e3')).toBe(1000)
  })

  it('names the field when it is empty', () => {
    expect(() => parseNumber('', 'Price')).toThrow('Price is empty')
    expect(() => parseNumber('   ')).toThrow(PercentageError)
  })

  it('rejects text and Infinity with a useful message', () => {
    expect(() => parseNumber('abc', 'Total')).toThrow('Total must be a number')
    expect(() => parseNumber('1,2,3')).toThrow(PercentageError)
    expect(() => parseNumber('1.2.3')).toThrow(PercentageError)
    expect(() => parseNumber('1e999')).toThrow('too large')
  })
})

describe('parseList', () => {
  it('splits on spaces, semicolons and newlines', () => {
    expect(parseList('1 2\n3;4')).toEqual([1, 2, 3, 4])
    expect(parseList('1, 2, 3')).toEqual([1, 2, 3])
  })

  it('keeps a comma that is really a thousands separator', () => {
    expect(parseList('1,250')).toEqual([1250])
    expect(parseList('1,250 3,000')).toEqual([1250, 3000])
    expect(parseList('10, 1,250')).toEqual([10, 1250])
    expect(parseList('1,2,3')).toEqual([1, 2, 3])
  })

  it('names the bad token', () => {
    expect(() => parseList('1, oops')).toThrow('oops')
    expect(() => parseList('   ')).toThrow('Add at least one part')
  })
})

describe('formatNumber / formatPercent', () => {
  it('groups thousands and trims float dust', () => {
    expect(formatNumber(1234.5678)).toBe('1,234.57')
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(30)).toBe('30')
  })

  it('never prints negative zero', () => {
    expect(formatNumber(-0)).toBe('0')
    expect(formatNumber(-0.001)).toBe('0')
  })

  it('falls back to the plain form for huge values', () => {
    expect(formatNumber(1e21)).toBe('1e+21')
  })

  it('keeps a huge value intact instead of corrupting it', () => {
    // Scaling up by 100 to round used to turn this into 999999999999999900000.
    expect(round(1e21, 2)).toBe(1e21)
    expect(round(1e16, 2)).toBe(1e16)
  })

  it('appends a percent sign', () => {
    expect(formatPercent(12.5)).toBe('12.5%')
  })
})

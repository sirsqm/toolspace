import { describe, expect, it } from 'vitest'
import { coefficientOfVariation, confidenceInterval, cumulativeShares, describeShape, fiveNumberSummary, frequencyBuckets, geometricMean, harmonicMean, kurtosis, MAX_VALUES, mean, median, medianAbsoluteDeviation, mode, outliers, parseNumbers, percentile, percentileRank, quartiles, skewness, standardDeviation, standardError, StatsError, sum, summarise, variance, zScores } from './stats'

const data = [2, 4, 4, 4, 5, 5, 7, 9]

describe('parseNumbers', () => {
  it('accepts any common separator', () => {
    expect(parseNumbers('1 2 3')).toEqual([1, 2, 3])
    expect(parseNumbers('1,2,3')).toEqual([1, 2, 3])
    expect(parseNumbers('1; 2\n3')).toEqual([1, 2, 3])
  })

  it('accepts decimals and negatives', () => {
    expect(parseNumbers('-1.5, 2.25')).toEqual([-1.5, 2.25])
  })

  it('rejects junk and empty input', () => {
    expect(() => parseNumbers('1 abc 3')).toThrow(StatsError)
    expect(() => parseNumbers('   ')).toThrow(StatsError)
  })

  it('says what is wrong with the offending token', () => {
    expect(() => parseNumbers('1 2 oops')).toThrow(/"oops" is not a number/)
    expect(() => parseNumbers('')).toThrow(/at least one number/)
  })

  it('reads scientific notation and signed values', () => {
    expect(parseNumbers('1e3 -2.5e-2 +4')).toEqual([1000, -0.025, 4])
  })

  it('refuses a paste larger than it can stay responsive on', () => {
    const huge = Array.from({ length: MAX_VALUES + 1 }, () => '1').join(' ')
    expect(() => parseNumbers(huge)).toThrow(/up to 200,000/)
    const atLimit = Array.from({ length: MAX_VALUES }, () => '1').join(' ')
    expect(parseNumbers(atLimit)).toHaveLength(MAX_VALUES)
  })

  it('rejects values that are not finite numbers', () => {
    expect(() => parseNumbers('Infinity')).toThrow(StatsError)
    expect(() => parseNumbers('NaN')).toThrow(StatsError)
  })
})

describe('mean / median / mode / sum', () => {
  it('computes the mean', () => {
    expect(mean(data)).toBe(5)
    expect(sum(data)).toBe(40)
  })

  it('computes the median for odd and even counts', () => {
    expect(median([1, 2, 3])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median(data)).toBe(4.5)
  })

  it('finds the mode, including ties', () => {
    expect(mode(data)).toEqual([4])
    expect(mode([1, 1, 2, 2, 3])).toEqual([1, 2])
    expect(mode([1, 2, 3])).toEqual([])
  })

  it('rejects empty input', () => {
    expect(() => mean([])).toThrow(StatsError)
    expect(() => median([])).toThrow(StatsError)
  })
})

describe('variance / standardDeviation', () => {
  it('separates sample and population', () => {
    // Population variance of 1..5 is 2, sample variance is 2.5.
    const values = [1, 2, 3, 4, 5]
    expect(variance(values, false)).toBe(2)
    expect(variance(values, true)).toBe(2.5)
  })

  it('computes the standard deviation', () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9], false)).toBeCloseTo(2)
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9], true)).toBeCloseTo(2.13809, 4)
  })

  it('needs two values for a sample', () => {
    expect(() => variance([1], true)).toThrow(StatsError)
    expect(variance([1], false)).toBe(0)
  })
})

describe('percentile / quartiles / outliers', () => {
  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
    expect(percentile([1, 2, 3, 4], 25)).toBe(1.75)
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4], 100)).toBe(4)
  })

  it('rejects an out-of-range percentile', () => {
    expect(() => percentile([1, 2], 101)).toThrow(StatsError)
    expect(() => percentile([1, 2], -1)).toThrow(StatsError)
  })

  it('computes quartiles and the IQR', () => {
    const result = quartiles([1, 2, 3, 4, 5])
    expect(result.q1).toBe(2)
    expect(result.q2).toBe(3)
    expect(result.q3).toBe(4)
    expect(result.iqr).toBe(2)
  })

  it('finds outliers', () => {
    expect(outliers([1, 2, 3, 4, 5, 100])).toEqual([100])
    expect(outliers([1, 2, 3, 4, 5])).toEqual([])
  })
})

describe('shape statistics', () => {
  it('reports zero skew for a symmetric set', () => {
    expect(skewness([1, 2, 3, 4, 5])).toBeCloseTo(0)
  })

  it('reports positive skew for a right tail', () => {
    expect(skewness([1, 1, 1, 1, 10])).toBeGreaterThan(0)
  })

  it('matches the spreadsheet figures for a small sample', () => {
    // Excel SKEW / KURT of 2,4,4,4,5,5,7,9 — the textbook answer, computed
    // from the sample standard deviation.
    expect(skewness(data)).toBeCloseTo(0.8184875533567997, 10)
    expect(kurtosis(data)).toBeCloseTo(0.940625, 10)
  })

  it('reports zero excess kurtosis for a normal-shaped sample', () => {
    expect(kurtosis([1, 2, 3, 4, 5])).toBeCloseTo(-1.2, 10)
    expect(kurtosis([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBeCloseTo(-1.2, 10)
  })

  it('says the shape is unknown when there is no spread', () => {
    expect(skewness([5, 5, 5, 5])).toBe(0)
    expect(kurtosis([5, 5, 5, 5])).toBe(0)
  })

  it('needs enough values', () => {
    expect(() => skewness([1, 2])).toThrow(StatsError)
    expect(() => kurtosis([1, 2, 3])).toThrow(StatsError)
  })
})

describe('medianAbsoluteDeviation / coefficientOfVariation / standardError', () => {
  it('measures spread without letting an outlier dominate', () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1)
    // The single 100 barely moves the median absolute deviation...
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 100])).toBe(1)
    // ...while the standard deviation more than doubles.
    expect(standardDeviation([1, 2, 3, 4, 100])).toBeGreaterThan(40)
  })

  it('expresses spread relative to the mean', () => {
    expect(coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(0.427617987059879, 10)
    // Mean zero: the ratio is undefined, not infinite.
    expect(coefficientOfVariation([-1, 1])).toBeNull()
    expect(coefficientOfVariation([-1, 0, 1])).toBeNull()
  })

  it('scales the standard error with the sample size', () => {
    expect(standardError([1])).toBeNull()
    expect(standardError([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(0.7559289460184544, 10)
  })
})

describe('confidenceInterval', () => {
  it('uses the t value while the sample is small', () => {
    const interval = confidenceInterval(data, 0.95)
    expect(interval.method).toBe('t')
    expect(interval.unreliable).toBe(true)
    expect(interval.low).toBeCloseTo(3.2122280426663554, 9)
    expect(interval.high).toBeCloseTo(6.787771957333645, 9)
  })

  it('widens for the higher confidence level', () => {
    const ninety = confidenceInterval(data, 0.95)
    const ninetyNine = confidenceInterval(data, 0.99)
    expect(ninetyNine.low).toBeLessThan(ninety.low)
    expect(ninetyNine.high).toBeGreaterThan(ninety.high)
  })

  it('falls back to the normal value past the t table', () => {
    const large = Array.from({ length: 40 }, (_, index) => index + 1)
    const interval = confidenceInterval(large, 0.95)
    expect(interval.method).toBe('normal')
    expect(interval.unreliable).toBe(false)
    expect(interval.low).toBeCloseTo(mean(large) - 1.96 * standardError(large)!, 10)
  })

  it('needs two values', () => {
    expect(() => confidenceInterval([1])).toThrow(StatsError)
  })
})

describe('percentileRank / cumulativeShares', () => {
  it('ranks a value against the set', () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(75)
    expect(percentileRank([1, 2, 3, 4], 0)).toBe(0)
    expect(percentileRank([1, 2, 3, 4], 4)).toBe(100)
    expect(percentileRank([1, 2, 3, 4], 4.5)).toBe(100)
  })

  it('rejects a target that is not a number', () => {
    expect(() => percentileRank([1, 2], Number.NaN)).toThrow(StatsError)
  })

  it('climbs to 100% across the sorted data', () => {
    const shares = cumulativeShares([3, 1, 2])
    expect(shares.map((share) => share.value)).toEqual([1, 2, 3])
    expect(shares[0].percent).toBeCloseTo(100 / 3, 10)
    expect(shares[1].percent).toBeCloseTo(200 / 3, 10)
    expect(shares[2].percent).toBe(100)
  })
})

describe('fiveNumberSummary', () => {
  it('lays the set out in drawing order', () => {
    expect(fiveNumberSummary(data)).toEqual({ min: 2, q1: 4, median: 4.5, q3: 5.5, max: 9 })
  })
})

describe('frequencyBuckets', () => {
  it('counts every value exactly once', () => {
    const values = Array.from({ length: 100 }, (_, index) => index)
    const buckets = frequencyBuckets(values, 10)
    expect(buckets).toHaveLength(10)
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(100)
    expect(buckets[0].count).toBe(10)
  })

  it('puts the top value in the last bucket rather than past the end', () => {
    const buckets = frequencyBuckets([0, 1, 2, 3, 4, 5, 6, 7, 8, 10], 5)
    expect(buckets[buckets.length - 1].count).toBe(2)
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(10)
  })

  it('returns one bucket when every value is the same', () => {
    expect(frequencyBuckets([7, 7, 7], 10)).toEqual([{ from: 7, to: 7, count: 3 }])
  })

  it('clamps the requested count to a sane range', () => {
    expect(frequencyBuckets([1, 2, 3], 0)).toHaveLength(1)
    expect(frequencyBuckets(Array.from({ length: 200 }, (_, index) => index), 999)).toHaveLength(50)
  })
})

describe('describeShape', () => {
  it('names the direction of the skew', () => {
    expect(describeShape(summarise([1, 1, 1, 1, 10]))).toContain('skewed to the right')
    expect(describeShape(summarise([1, 10, 10, 10, 10]))).toContain('skewed to the left')
    expect(describeShape(summarise([1, 2, 3, 4, 5]))).toContain('roughly symmetric')
  })

  it('counts outliers in words', () => {
    expect(describeShape(summarise([1, 2, 3, 4, 5]))).toContain('No outliers')
    expect(describeShape(summarise([1, 2, 3, 4, 5, 100]))).toContain('1 outlier by the 1.5 x IQR rule')
  })

  it('declines to guess from too little data', () => {
    expect(describeShape(summarise([1, 2]))).toBe('Too few values to describe the shape.')
  })
})

describe('precision on awkward input', () => {
  it('keeps small values that a plain sum would lose', () => {
    // 1e16 + 1 is not representable, so a naive total drops the ones.
    const values = [1e16, 1, 1, 1, 1]
    expect(sum(values)).toBe(1e16 + 4)
    expect(mean(values)).toBeCloseTo((1e16 + 4) / 5, 6)
  })

  it('handles a mode over a large set without a spread overflow', () => {
    const large = Array.from({ length: 150000 }, (_, index) => index % 7)
    // A single spread of 150,000 counts overflows the call stack.
    expect(mode(large)).toEqual([0, 1, 2, 3])
  })

  it('summarises a very large set', () => {
    const large = Array.from({ length: 50000 }, (_, index) => (index % 100) - 50)
    const result = summarise(large)
    expect(result.count).toBe(50000)
    expect(result.mean).toBeCloseTo(-0.5, 10)
    expect(result.min).toBe(-50)
    expect(result.max).toBe(49)
    expect(result.outlierCount).toBe(0)
  })
})

describe('geometricMean / harmonicMean', () => {
  it('computes both means', () => {
    expect(geometricMean([1, 4, 16])).toBe(4)
    expect(harmonicMean([1, 2, 4])).toBeCloseTo(12 / 7)
  })

  it('rejects values they cannot handle', () => {
    expect(() => geometricMean([1, -2])).toThrow(StatsError)
    expect(() => harmonicMean([1, 0])).toThrow(StatsError)
  })
})

describe('zScores', () => {
  it('centres the scores on zero', () => {
    const scores = zScores([1, 2, 3, 4, 5])
    expect(scores.reduce((total, value) => total + value, 0)).toBeCloseTo(0)
    expect(scores[4]).toBeGreaterThan(0)
  })

  it('returns zeroes when there is no spread', () => {
    expect(zScores([5, 5, 5])).toEqual([0, 0, 0])
  })
})

describe('summarise', () => {
  it('collects the whole picture', () => {
    const result = summarise(data)
    expect(result.count).toBe(8)
    expect(result.min).toBe(2)
    expect(result.max).toBe(9)
    expect(result.range).toBe(7)
    expect(result.median).toBe(4.5)
    expect(result.mode).toEqual([4])
    expect(result.quartiles.iqr).toBeCloseTo(1.5)
    expect(result.skewness).not.toBeNull()
    expect(result.kurtosis).not.toBeNull()
    expect(result.medianAbsoluteDeviation).toBe(0.5)
    expect(result.outliers).toEqual([9])
    expect(result.interval95?.low).toBeCloseTo(3.2122280426663554, 9)
    expect(result.fiveNumber).toEqual({ min: 2, q1: 4, median: 4.5, q3: 5.5, max: 9 })
  })

  it('leaves advanced figures out when there is too little data', () => {
    const result = summarise([1, 2])
    expect(result.skewness).toBeNull()
    expect(result.kurtosis).toBeNull()
    expect(result.varianceSample).toBe(0.5)
    expect(result.interval95).not.toBeNull()
    expect(result.coefficientOfVariation).not.toBeNull()
  })

  it('leaves the spread ratio out when the mean is zero', () => {
    expect(summarise([-1, 0, 1]).coefficientOfVariation).toBeNull()
    expect(summarise([0]).standardError).toBeNull()
    expect(summarise([0]).interval99).toBeNull()
  })

  it('lists the outliers it counted', () => {
    const result = summarise([1, 2, 3, 4, 5, 100])
    expect(result.outliers).toEqual([100])
    expect(result.outlierCount).toBe(1)
  })

  it('skips means that need positive values', () => {
    expect(summarise([-1, 2, 3]).geometricMean).toBeNull()
    expect(summarise([0, 2, 3]).harmonicMean).toBeNull()
  })
})

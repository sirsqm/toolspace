/**
 * Descriptive statistics.
 *
 * Sample variance divides by n-1 and population variance by n, and the two are
 * kept as separate functions rather than a flag so the choice is visible at the
 * call site. Quartiles use linear interpolation between ranks, which matches
 * what a spreadsheet reports for the same data.
 */

export class StatsError extends Error {}

/** Refuse a paste large enough to make the page stutter. */
export const MAX_VALUES = 200000

/** Parse a list of numbers from free text, ignoring separators and blanks. */
export function parseNumbers(input: string): number[] {
  const parts = input
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length > MAX_VALUES) {
    throw new StatsError(`That is ${parts.length.toLocaleString('en-US')} values; this tool reads up to ${MAX_VALUES.toLocaleString('en-US')} at a time`)
  }
  const numbers: number[] = []
  for (const part of parts) {
    const value = Number(part)
    if (!Number.isFinite(value)) throw new StatsError(`"${part}" is not a number`)
    numbers.push(value)
  }
  if (numbers.length === 0) throw new StatsError('Enter at least one number')
  return numbers
}

function requireData(values: readonly number[], minimum = 1): void {
  if (values.length < minimum) throw new StatsError(`This needs at least ${minimum} ${minimum === 1 ? 'value' : 'values'}`)
  if (values.some((value) => !Number.isFinite(value))) throw new StatsError('Every value must be a finite number')
}

/**
 * Total, with Kahan compensation.
 *
 * A plain `reduce` loses the small values once the running total dwarfs them,
 * so a long column of large numbers with a few small ones drifts. The
 * compensation term keeps the lost low bits, which matters most for the
 * variance, where every value is squared around the mean.
 */
export function sum(values: readonly number[]): number {
  let total = 0
  let carry = 0
  for (const value of values) {
    const adjusted = value - carry
    const next = total + adjusted
    carry = next - total - adjusted
    total = next
  }
  return total
}

export function mean(values: readonly number[]): number {
  requireData(values)
  return sum(values) / values.length
}

/** Middle value, or the average of the two middle values. */
export function median(values: readonly number[]): number {
  requireData(values)
  return medianOfSorted([...values].sort((a, b) => a - b))
}

/** Median of an already-sorted list, so callers can share one sort. */
function medianOfSorted(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Most frequent value. Ties resolve to the smallest value. */
export function mode(values: readonly number[]): number[] {
  requireData(values)
  const counts = new Map<number, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  // A loop, not Math.max(...counts.values()): a spread of a few hundred
  // thousand arguments overflows the call stack on a large paste.
  let highest = 0
  for (const count of counts.values()) if (count > highest) highest = count
  if (highest === 1) return []
  return [...counts.entries()].filter(([, count]) => count === highest).map(([value]) => value).sort((a, b) => a - b)
}

export function variance(values: readonly number[], sample = true): number {
  requireData(values, sample ? 2 : 1)
  const average = mean(values)
  const total = sum(values.map((value) => (value - average) ** 2))
  return total / (sample ? values.length - 1 : values.length)
}

export function standardDeviation(values: readonly number[], sample = true): number {
  return Math.sqrt(variance(values, sample))
}

/** Value at a percentile, interpolating between ranks. `p` is 0-100. */
export function percentile(values: readonly number[], p: number): number {
  requireData(values)
  return percentileOfSorted([...values].sort((a, b) => a - b), p)
}

function percentileOfSorted(sorted: readonly number[], p: number): number {
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new StatsError('A percentile must be between 0 and 100')
  const rank = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
}

export interface Quartiles {
  q1: number
  q2: number
  q3: number
  iqr: number
}

export function quartiles(values: readonly number[]): Quartiles {
  requireData(values)
  return quartilesOfSorted([...values].sort((a, b) => a - b))
}

function quartilesOfSorted(sorted: readonly number[]): Quartiles {
  const q1 = percentileOfSorted(sorted, 25)
  const q2 = percentileOfSorted(sorted, 50)
  const q3 = percentileOfSorted(sorted, 75)
  return { q1, q2, q3, iqr: q3 - q1 }
}

/** Values more than 1.5 IQR from the quartiles. */
export function outliers(values: readonly number[]): number[] {
  return outliersOfSorted([...values].sort((a, b) => a - b))
}

function outliersOfSorted(sorted: readonly number[]): number[] {
  const { q1, q3, iqr } = quartilesOfSorted(sorted)
  const low = q1 - 1.5 * iqr
  const high = q3 + 1.5 * iqr
  return sorted.filter((value) => value < low || value > high)
}

/** Minimum, quartiles and maximum, in the order a box plot draws them. */
export interface FiveNumber {
  min: number
  q1: number
  median: number
  q3: number
  max: number
}

export function fiveNumberSummary(values: readonly number[]): FiveNumber {
  requireData(values)
  return fiveNumberOfSorted([...values].sort((a, b) => a - b))
}

function fiveNumberOfSorted(sorted: readonly number[]): FiveNumber {
  const { q1, q3 } = quartilesOfSorted(sorted)
  return { min: sorted[0], q1, median: medianOfSorted(sorted), q3, max: sorted[sorted.length - 1] }
}

/** Fisher's measure of skewness; positive means a longer right tail. */
export function skewness(values: readonly number[]): number {
  requireData(values, 3)
  const average = mean(values)
  const sd = standardDeviation(values, true)
  if (sd === 0) return 0
  const total = sum(values.map((value) => ((value - average) / sd) ** 3))
  return (values.length / ((values.length - 1) * (values.length - 2))) * total
}

/** Excess kurtosis; 0 is a normal distribution. */
export function kurtosis(values: readonly number[]): number {
  requireData(values, 4)
  const average = mean(values)
  const sd = standardDeviation(values, true)
  if (sd === 0) return 0
  const n = values.length
  const total = sum(values.map((value) => ((value - average) / sd) ** 4))
  return (n * (n + 1) * total) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
}

/** Middle value of the distances from the median — spread that ignores outliers. */
export function medianAbsoluteDeviation(values: readonly number[]): number {
  requireData(values)
  return medianAbsoluteDeviationOfSorted([...values].sort((a, b) => a - b))
}

function medianAbsoluteDeviationOfSorted(sorted: readonly number[]): number {
  const centre = medianOfSorted(sorted)
  return medianOfSorted(sorted.map((value) => Math.abs(value - centre)).sort((a, b) => a - b))
}

/** Spread as a share of the mean, so sets in different units can be compared. */
export function coefficientOfVariation(values: readonly number[], sample = true): number | null {
  const average = mean(values)
  if (average === 0) return null
  return standardDeviation(values, sample) / Math.abs(average)
}

/** Standard error of the mean: how far the sample mean is likely to sit from the truth. */
export function standardError(values: readonly number[]): number | null {
  if (values.length < 2) return null
  return standardDeviation(values, true) / Math.sqrt(values.length)
}

/** Two-sided critical values for 95% and 99%, by degrees of freedom. */
const T_TABLE: Record<number, [number, number]> = {
  1: [12.706, 63.657], 2: [4.303, 9.925], 3: [3.182, 5.841], 4: [2.776, 4.604],
  5: [2.571, 4.032], 6: [2.447, 3.707], 7: [2.365, 3.499], 8: [2.306, 3.355],
  9: [2.262, 3.25], 10: [2.228, 3.169], 11: [2.201, 3.106], 12: [2.179, 3.055],
  13: [2.16, 3.012], 14: [2.145, 2.977], 15: [2.131, 2.947], 16: [2.12, 2.921],
  17: [2.11, 2.898], 18: [2.101, 2.878], 19: [2.093, 2.861], 20: [2.086, 2.845],
  21: [2.08, 2.831], 22: [2.074, 2.819], 23: [2.069, 2.807], 24: [2.064, 2.797],
  25: [2.06, 2.787], 26: [2.056, 2.779], 27: [2.052, 2.771], 28: [2.048, 2.763],
  29: [2.045, 2.756], 30: [2.042, 2.75],
}

export interface Interval {
  low: number
  high: number
  /** `t` for small samples, `normal` once the table runs out. */
  method: 't' | 'normal'
  /** True when the sample is too small for the interval to mean much. */
  unreliable: boolean
}

/**
 * Confidence interval for the mean. Uses the Student t critical value while the
 * sample is small enough for that to matter, and the normal value beyond it.
 * The interval describes the mean, not the spread of the values.
 */
export function confidenceInterval(values: readonly number[], level: 0.95 | 0.99 = 0.95): Interval {
  const error = standardError(values)
  if (error == null) throw new StatsError('A confidence interval needs at least two values')
  const df = values.length - 1
  const column = level === 0.99 ? 1 : 0
  const row = T_TABLE[df]
  const critical = row ? row[column] : level === 0.99 ? 2.5758 : 1.96
  const average = mean(values)
  return {
    low: average - critical * error,
    high: average + critical * error,
    method: row ? 't' : 'normal',
    unreliable: values.length < 30,
  }
}

/** Where a value sits in the set: the percent of values at or below it. */
export function percentileRank(values: readonly number[], target: number): number {
  requireData(values)
  if (!Number.isFinite(target)) throw new StatsError('Enter a number to rank')
  const atOrBelow = values.filter((value) => value <= target).length
  return (atOrBelow / values.length) * 100
}

/** The share of the data at or below each value, ascending — a reading of the distribution. */
export function cumulativeShares(values: readonly number[]): { value: number; percent: number }[] {
  requireData(values)
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.map((value, index) => ({ value, percent: ((index + 1) / sorted.length) * 100 }))
}

export interface Bucket {
  /** Inclusive lower edge. */
  from: number
  /** Exclusive upper edge, except for the last bucket. */
  to: number
  count: number
}

/**
 * Equal-width buckets across the data, for a histogram. A set with no spread
 * still yields one bucket, so the caller never has to special-case it.
 */
export function frequencyBuckets(values: readonly number[], requested = 10): Bucket[] {
  requireData(values)
  const count = Math.max(1, Math.min(50, Math.floor(requested) || 1))
  // A loop, not Math.min(...values): spreading a large paste as arguments
  // overflows the call stack.
  let low = values[0]
  let high = values[0]
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  if (high === low) return [{ from: low, to: high, count: values.length }]
  const width = (high - low) / count
  const buckets: Bucket[] = Array.from({ length: count }, (_, index) => ({
    from: low + index * width,
    to: low + (index + 1) * width,
    count: 0,
  }))
  for (const value of values) {
    // The top edge belongs to the last bucket rather than to a bucket that
    // does not exist.
    const index = Math.min(count - 1, Math.floor((value - low) / width))
    buckets[index].count += 1
  }
  return buckets
}

/** A plain sentence about the shape, from an already-computed summary. */
export function describeShape(summary: Summary): string {
  if (summary.count < 3) return 'Too few values to describe the shape.'
  const skew = summary.skewness ?? 0
  const kurt = summary.kurtosis
  const direction =
    Math.abs(skew) < 0.5 ? 'roughly symmetric' : skew > 0 ? 'skewed to the right (a longer high tail)' : 'skewed to the left (a longer low tail)'
  const tail =
    kurt == null
      ? ''
      : Math.abs(kurt) < 0.5
        ? ' with tails like a normal distribution'
        : kurt > 0
          ? ' with heavier tails than a normal distribution'
          : ' with lighter tails than a normal distribution'
  const extra =
    summary.outlierCount === 0
      ? ' No outliers by the 1.5 x IQR rule.'
      : ` ${summary.outlierCount} outlier${summary.outlierCount === 1 ? '' : 's'} by the 1.5 x IQR rule.`
  return `The distribution is ${direction}${tail}.${extra}`
}

export function geometricMean(values: readonly number[]): number {
  requireData(values)
  if (values.some((value) => value <= 0)) throw new StatsError('The geometric mean needs positive values')
  return Math.exp(sum(values.map((value) => Math.log(value))) / values.length)
}

export function harmonicMean(values: readonly number[]): number {
  requireData(values)
  if (values.some((value) => value === 0)) throw new StatsError('The harmonic mean cannot include zero')
  return values.length / sum(values.map((value) => 1 / value))
}

/** How many standard deviations each value sits from the mean. */
export function zScores(values: readonly number[]): number[] {
  requireData(values, 2)
  const average = mean(values)
  const sd = standardDeviation(values, true)
  if (sd === 0) return values.map(() => 0)
  return values.map((value) => (value - average) / sd)
}

export interface Summary {
  count: number
  sum: number
  min: number
  max: number
  range: number
  mean: number
  median: number
  mode: number[]
  varianceSample: number
  variancePopulation: number
  standardDeviationSample: number
  standardDeviationPopulation: number
  quartiles: Quartiles
  skewness: number | null
  kurtosis: number | null
  geometricMean: number | null
  harmonicMean: number | null
  /** Middle absolute deviation from the median — a spread outliers cannot inflate. */
  medianAbsoluteDeviation: number
  /** Standard deviation as a share of the mean; null when the mean is zero. */
  coefficientOfVariation: number | null
  standardError: number | null
  interval95: Interval | null
  interval99: Interval | null
  outliers: number[]
  outlierCount: number
  fiveNumber: FiveNumber
}

/** Everything the tool shows, in one pass over one sort. */
export function summarise(values: readonly number[]): Summary {
  requireData(values)
  const sorted = [...values].sort((a, b) => a - b)
  const positive = values.every((value) => value > 0)
  const nonZero = values.every((value) => value !== 0)
  const found = outliersOfSorted(sorted)
  return {
    count: values.length,
    sum: sum(values),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    range: sorted[sorted.length - 1] - sorted[0],
    mean: mean(values),
    median: medianOfSorted(sorted),
    mode: mode(values),
    varianceSample: values.length >= 2 ? variance(values, true) : 0,
    variancePopulation: variance(values, false),
    standardDeviationSample: values.length >= 2 ? standardDeviation(values, true) : 0,
    standardDeviationPopulation: standardDeviation(values, false),
    quartiles: quartilesOfSorted(sorted),
    skewness: values.length >= 3 ? skewness(values) : null,
    kurtosis: values.length >= 4 ? kurtosis(values) : null,
    geometricMean: positive ? geometricMean(values) : null,
    harmonicMean: nonZero ? harmonicMean(values) : null,
    medianAbsoluteDeviation: medianAbsoluteDeviationOfSorted(sorted),
    coefficientOfVariation: values.length >= 2 ? coefficientOfVariation(values, true) : null,
    standardError: standardError(values),
    interval95: values.length >= 2 ? confidenceInterval(values, 0.95) : null,
    interval99: values.length >= 2 ? confidenceInterval(values, 0.99) : null,
    outliers: found,
    outlierCount: found.length,
    fiveNumber: fiveNumberOfSorted(sorted),
  }
}

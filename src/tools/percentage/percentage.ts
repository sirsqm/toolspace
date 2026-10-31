/**
 * Percentage maths.
 *
 * Every function guards against the cases that usually go wrong: dividing by
 * zero, and a base of zero when working out the share of a total. Rounding is
 * kept out of the maths so callers decide how to display the result.
 *
 * The parsing helpers live here too, so the UI never has to guess what a user
 * typed: `Number('')` is `0`, which silently turns an empty box into a real
 * answer. `parseNumber` rejects blank and non-numeric text instead.
 */

export class PercentageError extends Error {}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new PercentageError(`${label} must be a number`)
  return value
}

/**
 * Read a number out of a text box.
 *
 * Accepts what people actually paste — a trailing `%`, thousands separators
 * with commas, spaces or underscores, a leading sign, an exponent — and
 * rejects everything else with a message naming the field, rather than
 * letting `Number()` quietly produce `NaN` or `0`.
 */
export function parseNumber(text: string, label = 'Value'): number {
  const trimmed = text.trim()
  if (trimmed === '') throw new PercentageError(`${label} is empty`)
  const cleaned = trimmed.replace(/%$/, '').trim()
  // A group of exactly three digits after a comma, space or underscore is a
  // thousands separator — "1,250" is one number, "1,2,3" is three.
  const normalised = cleaned
    .replace(/,(?=\d{3}(?:\D|$))/g, '')
    .replace(/(?<=\d)\s(?=\d{3}(?:\D|$))/g, '')
    .replace(/_/g, '')
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(normalised)) {
    throw new PercentageError(`${label} must be a number`)
  }
  const value = Number(normalised)
  if (!Number.isFinite(value)) throw new PercentageError(`${label} is too large`)
  return value
}

/**
 * Split a free-form list of numbers, naming the token that failed.
 *
 * A list is separated by whitespace, semicolons or newlines. A comma only
 * separates when it is not a thousands separator, so a pasted “1,250” stays
 * one part instead of silently becoming two — the same rule `parseNumber`
 * applies to a single box. Writing the same list on two lines is unambiguous.
 */
export function parseList(text: string, label = 'Every part'): number[] {
  const tokens = text
    .split(/[\s;]+/)
    .filter((token) => token !== '')
    .flatMap((token) => splitOnCommas(token))
  if (tokens.length === 0) throw new PercentageError('Add at least one part')
  return tokens.map((token) => parseNumber(token, `${label} (“${token}”)`))
}

function splitOnCommas(token: string): string[] {
  // A token that is a whole grouped number — "1,250", "12,500.50" — stays as it is.
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d*)?([eE][+-]?\d+)?$/.test(token)) return [token]
  return token.split(',').filter((part) => part !== '')
}

/** What is `percent` percent of `value`? */
export function percentOf(percent: number, value: number): number {
  requireFinite(percent, 'The percentage')
  requireFinite(value, 'The value')
  return (percent / 100) * value
}

/** `part` is what percent of `whole`? */
export function percentOfTotal(part: number, whole: number): number {
  requireFinite(part, 'The part')
  requireFinite(whole, 'The total')
  if (whole === 0) throw new PercentageError('The total cannot be zero')
  return (part / whole) * 100
}

/** Percentage change from `from` to `to`. */
export function percentChange(from: number, to: number): number {
  requireFinite(from, 'The original value')
  requireFinite(to, 'The new value')
  if (from === 0) throw new PercentageError('The original value cannot be zero')
  return ((to - from) / Math.abs(from)) * 100
}

export type ChangeDirection = 'increase' | 'decrease' | 'unchanged' | 'from-zero'

export interface Change {
  direction: ChangeDirection
  /** Signed percentage, or `null` when the change is undefined (a zero base). */
  percent: number | null
}

/**
 * Read a change the way a person would describe it.
 *
 * `percentChange(0, 10)` has no honest answer — every percentage of nothing is
 * nothing — so the direction becomes `from-zero` and the percentage is `null`
 * rather than a misleading `Infinity` or a silent dash.
 */
export function describeChange(from: number, to: number): Change {
  requireFinite(from, 'The original value')
  requireFinite(to, 'The new value')
  if (from === to) return { direction: 'unchanged', percent: 0 }
  if (from === 0) return { direction: 'from-zero', percent: null }
  const percent = percentChange(from, to)
  return { direction: percent > 0 ? 'increase' : 'decrease', percent }
}

/** The original value, given a result and the percentage that produced it. */
export function reversePercent(result: number, percent: number): number {
  requireFinite(result, 'The result')
  requireFinite(percent, 'The percentage')
  const factor = 1 + percent / 100
  if (factor === 0) throw new PercentageError('A change of -100% has no original value')
  return result / factor
}

/** Apply a discount percentage to a price. */
export function applyDiscount(price: number, discount: number): number {
  return price - percentOf(discount, price)
}

/** Add a markup percentage to a cost. */
export function applyMarkup(cost: number, markup: number): number {
  return cost + percentOf(markup, cost)
}

/** Split a total into parts by weight, as percentages that sum to 100. */
export function percentBreakdown(values: readonly number[]): number[] {
  if (values.length === 0) return []
  if (values.some((value) => !Number.isFinite(value))) throw new PercentageError('Every part must be a number')
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total === 0) throw new PercentageError('The parts add up to zero')
  return values.map((value) => (value / total) * 100)
}

/**
 * Split `total` across `weights` so the parts add back up to `total` exactly.
 *
 * Rounding each share on its own loses (or invents) cents, which is the classic
 * "the invoices are a penny short" bug. This uses largest-remainder
 * apportionment: floor every exact share at the requested precision, then hand
 * the leftover units to the parts with the biggest fractional remainders.
 */
export function allocate(total: number, weights: readonly number[], decimals = 2): number[] {
  requireFinite(total, 'The total')
  if (weights.length === 0) return []
  if (weights.some((weight) => !Number.isFinite(weight))) {
    throw new PercentageError('Every weight must be a number')
  }
  if (weights.some((weight) => weight < 0)) {
    throw new PercentageError('Weights cannot be negative')
  }
  const sum = weights.reduce((running, weight) => running + weight, 0)
  if (sum === 0) throw new PercentageError('The weights add up to zero')

  const sign = total < 0 ? -1 : 1
  const magnitude = Math.abs(total)
  const scale = 10 ** decimals
  const exact = weights.map((weight) => (weight / sum) * magnitude * scale)
  const units = exact.map(Math.floor)
  let leftover = Math.round(magnitude * scale) - units.reduce((running, unit) => running + unit, 0)
  const byRemainder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let cursor = 0; cursor < byRemainder.length && leftover > 0; cursor += 1, leftover -= 1) {
    units[byRemainder[cursor].index] += 1
  }
  return units.map((unit) => (unit / scale) * sign)
}

export interface BreakdownRow {
  /** 1-based position, so the label matches the input order. */
  index: number
  weight: number
  /** Share of the total, as a percentage. */
  share: number
  /** The weight's slice of the amount, rounded so the column adds up. */
  amount: number
}

/** Per-part shares and amounts for a total, ready to render. */
export function breakdownRows(total: number, weights: readonly number[], decimals = 2): BreakdownRow[] {
  if (weights.length === 0) return []
  const shares = percentBreakdown(weights)
  const amounts = allocate(total, weights, decimals)
  return weights.map((weight, position) => ({
    index: position + 1,
    weight,
    share: shares[position],
    amount: amounts[position],
  }))
}

export interface MarginResult {
  margin: number
  markup: number
}

/** Margin (profit over revenue) and markup (profit over cost) for a price. */
export function marginAndMarkup(cost: number, price: number): MarginResult {
  requireFinite(cost, 'The cost')
  requireFinite(price, 'The price')
  const profit = price - cost
  if (price === 0) throw new PercentageError('The price cannot be zero')
  if (cost === 0) throw new PercentageError('The cost cannot be zero')
  return { margin: (profit / price) * 100, markup: (profit / cost) * 100 }
}

/** Round to a number of decimal places, avoiding float dust. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) throw new PercentageError('Cannot round a non-finite number')
  const factor = 10 ** decimals
  // Past the point where a single unit of `factor` is still representable, the
  // scale-up/scale-down trip through doubles corrupts the value (1e21 became
  // 999999999999999900000). There are no meaningful decimals left at that size,
  // so hand the value back untouched.
  if (!Number.isFinite(factor) || Math.abs(value) * factor >= 2 ** 53) return value
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor
}

/**
 * Render a figure for display: grouped thousands, no float dust, and no
 * `-0`. Past 1e15 the grouped string stops being readable, so those fall back
 * to the plain form the platform already uses.
 */
export function formatNumber(value: number, decimals = 2): string {
  const rounded = round(value, decimals)
  if (Object.is(rounded, -0)) return '0'
  if (Math.abs(rounded) >= 1e15) return String(rounded)
  return rounded.toLocaleString('en-US', { maximumFractionDigits: decimals })
}

/** `formatNumber` with a percent sign. */
export function formatPercent(value: number, decimals = 2): string {
  return `${formatNumber(value, decimals)}%`
}

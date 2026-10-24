/**
 * Human duration parsing and formatting.
 *
 * Parsing accepts the loose forms people actually type ("1h30m", "2 days
 * 4 hours", "90s") as well as an ISO-8601 duration. Values are returned in
 * milliseconds, and formatting can choose between a compact clock and words.
 */

export class DurationError extends Error {}

export interface Unit {
  ms: number
  names: string[]
  short: string
}

export const UNITS: Unit[] = [
  { ms: 31557600000, names: ['year', 'years', 'y', 'yr', 'yrs'], short: 'y' },
  { ms: 2629800000, names: ['month', 'months', 'mo', 'mos'], short: 'mo' },
  { ms: 604800000, names: ['week', 'weeks', 'w', 'wk', 'wks'], short: 'w' },
  { ms: 86400000, names: ['day', 'days', 'd'], short: 'd' },
  { ms: 3600000, names: ['hour', 'hours', 'h', 'hr', 'hrs'], short: 'h' },
  { ms: 60000, names: ['minute', 'minutes', 'min', 'mins', 'm'], short: 'm' },
  { ms: 1000, names: ['second', 'seconds', 'sec', 'secs', 's'], short: 's' },
  { ms: 1, names: ['millisecond', 'milliseconds', 'ms', 'msec', 'msecs'], short: 'ms' },
]

const BY_NAME = new Map<string, number>()
for (const unit of UNITS) for (const name of unit.names) BY_NAME.set(name, unit.ms)

/** The unit whose magnitude is closest to (but not above) the value. */
export function largestUnit(ms: number): Unit {
  const magnitude = Math.abs(ms)
  for (const unit of UNITS) if (magnitude >= unit.ms) return unit
  return UNITS[UNITS.length - 1]
}

const CLOCK = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/
const ISO = /^P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i
const NUMBER = /^\d+(?:\.\d+)?$/

/** Parse a duration string into milliseconds. A leading - or + sets the sign. */
export function parseDuration(input: string): number {
  const raw = input.trim()
  if (!raw) throw new DurationError('Enter a duration, for example 1h30m')

  const sign = /^[-−]/.test(raw) ? -1 : 1
  const body = /^[-−+]/.test(raw) ? raw.slice(1).trim() : raw
  if (!body) throw new DurationError('Enter a duration after the sign, for example -1h30m')

  return sign * parseMagnitude(body.toLowerCase())
}

function parseMagnitude(text: string): number {
  const clock = CLOCK.exec(text)
  if (clock) {
    const [, hours, minutes, seconds = '0', millis = '0'] = clock
    if (Number(minutes) > 59) throw new DurationError(`"${minutes}" is not a valid minute; the minutes field must be 0–59`)
    if (Number(seconds) > 59) throw new DurationError(`"${seconds}" is not a valid second; the seconds field must be 0–59`)
    return Number(hours) * 3600000 + Number(minutes) * 60000 + Number(seconds) * 1000 + Number(millis.padEnd(3, '0'))
  }

  if (text.startsWith('p')) return parseIso(text)

  // Insert a space between a number and its unit so "1h30m" tokenises cleanly.
  const spaced = text.replace(/(\d+(?:\.\d+)?)\s*/g, '$1 ').replace(/([a-z]+)/g, ' $1 ').trim()
  const tokens = spaced.split(/\s+/)
  let total = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!NUMBER.test(token)) throw new DurationError(`"${token}" is not a number`)
    const value = Number(token)
    const next = tokens[i + 1]
    const unit = next ? BY_NAME.get(next) : 1000
    if (next && unit === undefined) throw new DurationError(`"${next}" is not a known unit`)
    total += value * (unit ?? 1000)
    if (next) i += 1
  }

  return total
}

/** Parse an ISO-8601 duration such as "P1DT2H". */
export function parseIso(text: string): number {
  const match = ISO.exec(text.trim())
  if (!match) throw new DurationError('That is not a valid ISO-8601 duration, for example P1DT2H')
  if (!match.slice(1).some((part) => part !== undefined)) {
    throw new DurationError('That duration has no components, for example P1DT2H')
  }
  const [years, months, weeks, days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number((part ?? '0').replace(',', '.')))
  const byShort = (short: string) => UNITS.find((unit) => unit.short === short)!.ms
  return (
    years * byShort('y') +
    months * byShort('mo') +
    weeks * byShort('w') +
    days * byShort('d') +
    hours * byShort('h') +
    minutes * byShort('m') +
    seconds * byShort('s')
  )
}

export interface FormatOptions {
  /** Use full unit names instead of single letters. */
  long?: boolean
  /** Include milliseconds. */
  millis?: boolean
  /** Show every unit, including zeroes. */
  pad?: boolean
}

/** Format milliseconds as a compact duration, e.g. "1h 30m". */
export function formatDuration(ms: number, options: FormatOptions = {}): string {
  const negative = ms < 0
  let remaining = Math.abs(Math.round(ms))
  const parts: string[] = []
  const units = options.millis ? UNITS : UNITS.filter((unit) => unit.ms >= 1000)

  for (const unit of units) {
    const value = Math.floor(remaining / unit.ms)
    remaining -= value * unit.ms
    if (value === 0 && !options.pad) continue
    parts.push(options.long ? `${value} ${value === 1 ? unit.names[0] : unit.names[1] ?? unit.names[0]}` : `${value}${unit.short}`)
  }

  if (parts.length === 0) parts.push(options.long ? '0 seconds' : '0s')
  return `${negative ? '-' : ''}${parts.join(' ')}`
}

/**
 * Format milliseconds as an ISO-8601 duration, e.g. "PT1H30M".
 *
 * Days are the largest unit, matching the `P#DT#H#M#S` shape that every
 * library and API accepts. The result round-trips through `parseDuration`.
 */
export function toIsoDuration(ms: number): string {
  if (!Number.isFinite(ms)) throw new DurationError('That value cannot be written as an ISO-8601 duration')
  const negative = ms < 0
  let remaining = Math.round(Math.abs(ms))
  const days = Math.floor(remaining / 86400000)
  remaining -= days * 86400000
  const hours = Math.floor(remaining / 3600000)
  remaining -= hours * 3600000
  const minutes = Math.floor(remaining / 60000)
  remaining -= minutes * 60000
  const seconds = remaining / 1000
  const time = `${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}${seconds ? `${trimNumber(seconds)}S` : ''}`
  const body = `${days ? `${days}D` : ''}${time ? `T${time}` : ''}`
  if (!body) return 'PT0S'
  return `${negative ? '-' : ''}P${body}`
}

/** Format milliseconds as a clock, e.g. "01:30:00" or "01:30". */
export function formatClock(ms: number): string {
  const negative = ms < 0
  let remaining = Math.floor(Math.abs(ms) / 1000)
  const hours = Math.floor(remaining / 3600)
  remaining -= hours * 3600
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining - minutes * 60
  const pad = (value: number) => String(value).padStart(2, '0')
  const body = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
  return `${negative ? '-' : ''}${body}`
}

/** Strip the trailing zeros a float division leaves behind: 1.500 -> 1.5. */
function trimNumber(value: number): string {
  return String(Number(value.toFixed(6)))
}

/**
 * Format an amount for a unit table.
 *
 * Raw division produces values like 0.000008928571428571428, which is
 * unreadable and stretches the row far past the panel. Keeping six
 * significant digits and grouping thousands fixes the common case; only the
 * extremes (below a millionth, above a quadrillion) fall back to exponent
 * notation, where fixed-point would be mostly zeroes.
 */
export function formatAmount(value: number, significant = 6): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '—'
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (magnitude >= 1e15 || magnitude < 1e-6) return value.toExponential(2)
  return Number(value.toPrecision(significant)).toLocaleString('en-US', { maximumFractionDigits: 20 })
}

/** Add several durations together. */
export function sumDurations(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * Number formatting.
 *
 * Parsing is deliberately forgiving: it strips grouping separators and
 * currency symbols, and understands both "1,234.56" and "1.234,56" by looking
 * at which separator comes last. Formatting uses Intl, so the grouping and
 * decimal marks follow the chosen locale rather than a hard-coded guess.
 */

export class NumberError extends Error {}

/** Signs people paste from a document or a spreadsheet, not just ASCII "-". */
const MINUS_SIGNS = /[\u2212\u2010-\u2015\u2043\u02d7\uff0d]/g

/**
 * A BCP 47 tag, optionally with extensions and a private-use part. Intl
 * accepts a little more than this, but this is the shape a user can type and
 * recognise; anything else is a typo we should report rather than silently
 * fall back on.
 */
const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export interface ParseOptions {
  /** Treat the last separator as the decimal mark. Defaults to true. */
  detectSeparators?: boolean
}

/** Parse a human number, tolerating grouping separators and a currency symbol. */
export function parseNumber(input: string, options: ParseOptions = {}): number {
  const raw = input.trim()
  if (!raw) throw new NumberError('Enter a number to format')

  let text = raw
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }

  // Unicode minus/en dash/fullwidth minus all mean the same thing as "-", and
  // they survive a copy from a PDF or Word doc.
  text = text.replace(MINUS_SIGNS, '-').replace(/[\s\u00a0\u202f]/g, '')
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }

  // Scientific notation ("1e6", "2,5E3"). The exponent has to be lifted out
  // before the non-numeric strip below, which would otherwise delete the "e"
  // and silently read 1e6 as 16.
  let exponent = 0
  const scientific = text.match(/^([\d.,]+)[eE]([+-]?\d+)$/)
  if (scientific) {
    exponent = Number(scientific[2])
    text = scientific[1]
  }

  // Drop anything that is not a digit or a separator: currency symbols, unit
  // suffixes, stray letters. Reject outright when nothing numeric survives, so
  // "abc" cannot silently become a number.
  text = text.replace(/[^\d.,]/g, '')
  if (!/\d/.test(text)) throw new NumberError(`"${raw}" has no digits to read`)

  if (options.detectSeparators ?? true) {
    const lastComma = text.lastIndexOf(',')
    const lastDot = text.lastIndexOf('.')
    const decimals = (mark: string) => text.length - text.lastIndexOf(mark) - 1

    // The separator with a one-to-two digit tail (or the only separator) is
    // the decimal mark; the other one groups thousands.
    let decimal: ',' | '.' | null = null
    if (lastComma !== -1 && lastDot !== -1) decimal = lastComma > lastDot ? ',' : '.'
    else if (lastComma !== -1) decimal = decimals(',') !== 3 || lastComma === 0 ? ',' : '.'
    else if (lastDot !== -1) decimal = decimals('.') === 3 ? ',' : '.'

    if (decimal === ',') text = text.replace(/\./g, '').replace(/,/g, '.')
    else if (decimal === '.') text = text.replace(/,/g, '')
    else text = text.replace(/[.,]/g, '')
  }

  let value = Number(text)
  if (exponent) value *= 10 ** exponent
  // A paste longer than ~1.8e308 overflows to Infinity. That is a real limit of
  // a browser number, not a typo, so say so instead of "not a number".
  if (value === Infinity || value === -Infinity) {
    throw new NumberError(`"${raw}" is too large for the browser to hold as a number`)
  }
  if (!Number.isFinite(value)) throw new NumberError(`"${raw}" is not a number`)
  return negative ? -value : value
}

/** The range Intl accepts for fraction digits. */
export const DECIMAL_LIMITS = { min: 0, max: 100 } as const

/**
 * Turn the raw decimals field into an Intl-safe digit count.
 *
 * An empty field means "use the default" rather than zero, and anything above
 * the Intl ceiling is clamped instead of throwing a RangeError out of the
 * formatter. Returns `undefined` when the caller should keep Intl's default.
 */
export function normalizeDecimals(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const value = Number(text)
  if (!Number.isFinite(value)) return undefined
  const whole = Math.trunc(value)
  if (whole < DECIMAL_LIMITS.min) return DECIMAL_LIMITS.min
  if (whole > DECIMAL_LIMITS.max) return DECIMAL_LIMITS.max
  return whole
}

/** True when the browser can build an Intl formatter for this locale tag. */
export function isValidLocale(code: string): boolean {
  const tag = code.trim()
  if (!tag || !LOCALE_TAG.test(tag)) return false
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length > 0
  } catch {
    return false
  }
}

/**
 * The units this browser's Intl data actually knows, or `undefined` when the
 * engine has no `Intl.supportedValuesOf`. Kept lazy so a browser without the
 * API costs nothing.
 */
let knownUnits: Set<string> | undefined
function supportedUnits(): Set<string> | undefined {
  if (knownUnits) return knownUnits
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supported !== 'function') return undefined
  try {
    knownUnits = new Set(supported('unit'))
  } catch {
    knownUnits = undefined
  }
  return knownUnits
}

/**
 * True when the browser can format this unit. Intl's unit list is small and
 * silently falls back to "5" for a unit it does not know, which reads as a
 * bug, so we check the list rather than trusting the format call.
 */
export function isValidUnit(unit: string): boolean {
  const name = unit.trim()
  if (!name) return false
  const known = supportedUnits()
  if (known) return known.has(name)
  // No supportedValuesOf: let the formatter's own fallback decide.
  try {
    return new Intl.NumberFormat('en-US', { style: 'unit', unit: name }).format(1) !== '1'
  } catch {
    return false
  }
}

/** True when the browser's Intl data recognises this ISO 4217 code. */
export function isSupportedCurrency(code: string): boolean {
  const name = code.trim().toUpperCase()
  if (!isCurrencyCode(name)) return false
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  if (typeof supported !== 'function') return true
  try {
    return supported('currency').includes(name)
  } catch {
    return true
  }
}

export interface FormatOptions {
  locale?: string
  style?: 'decimal' | 'currency' | 'percent' | 'unit'
  currency?: string
  unit?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  compact?: boolean
  compactDisplay?: 'short' | 'long'
  signDisplay?: 'auto' | 'always' | 'never' | 'exceptZero'
}

/** True when the code looks like an ISO 4217 currency. */
export function isCurrencyCode(code: string): boolean {
  return /^[A-Za-z]{3}$/.test(code.trim())
}

/**
 * Format a number with Intl, turning bad options into plain-language errors
 * rather than leaking an Intl RangeError.
 */
export function formatNumber(value: number, options: FormatOptions = {}): string {
  if (!Number.isFinite(value)) throw new NumberError('Only finite numbers can be formatted')
  const { locale = 'en-US', style = 'decimal', compact = false, ...rest } = options
  if (style === 'currency' && !isCurrencyCode(options.currency ?? '')) {
    const shown = options.currency?.trim() || '(empty)'
    throw new NumberError(`"${shown}" is not a three-letter currency code — try USD or EUR.`)
  }
  if (style === 'currency' && !isSupportedCurrency(options.currency ?? '')) {
    throw new NumberError(`This browser has no data for "${options.currency?.trim().toUpperCase()}" — try USD, EUR or JPY.`)
  }
  if (style === 'unit' && !(options.unit ?? '').trim()) {
    throw new NumberError('Enter a unit for the unit format — try kilometer, byte or liter.')
  }
  if (style === 'unit' && !isValidUnit(options.unit ?? '')) {
    throw new NumberError(`This browser has no unit "${options.unit?.trim()}" — try kilometer, byte, liter or celsius.`)
  }
  try {
    return new Intl.NumberFormat(locale, {
      style,
      notation: compact ? 'compact' : 'standard',
      compactDisplay: compact ? rest.compactDisplay ?? 'short' : undefined,
      currency: style === 'currency' ? options.currency ?? 'USD' : undefined,
      unit: style === 'unit' ? options.unit ?? 'kilometer' : undefined,
      minimumFractionDigits: rest.minimumFractionDigits,
      maximumFractionDigits: rest.maximumFractionDigits,
      signDisplay: rest.signDisplay ?? 'auto',
    }).format(value)
  } catch (err) {
    throw new NumberError(err instanceof Error ? err.message : 'That locale or option is not supported')
  }
}

/** Fixed decimal places, without Intl grouping. */
export function toFixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) throw new NumberError('Only finite numbers can be formatted')
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) throw new NumberError('Decimal places must be between 0 and 100')
  return value.toFixed(decimals)
}

/** Engineering-style abbreviation, e.g. 1500 -> "1.5K". */
export function abbreviate(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) throw new NumberError('Only finite numbers can be abbreviated')
  const units = ['', 'K', 'M', 'B', 'T', 'P', 'E']
  const sign = value < 0 ? '-' : ''
  let magnitude = Math.abs(value)
  let index = 0
  while (magnitude >= 1000 && index < units.length - 1) {
    magnitude /= 1000
    index += 1
  }
  const rounded = Number(magnitude.toFixed(decimals))
  return `${sign}${rounded}${units[index]}`
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = ['', ' thousand', ' million', ' billion', ' trillion', ' quadrillion', ' quintillion', ' sextillion']

/** The largest value with a name in the scale table, as an exact integer. */
export const MAX_WORDS_VALUE = 10n ** BigInt(SCALES.length * 3)

/**
 * The exact digits of a whole number the user typed, when the double it parsed
 * to cannot represent them. `"9007199254740993"` parses to 9007199254740992,
 * so anything reading `value` alone would show the wrong integer. Returns
 * `undefined` when the input is not a plain whole number or when the double is
 * already exact, so the caller can fall back to the number.
 */
export function exactIntegerDigits(value: number, raw: string | undefined): string | undefined {
  const typed = raw?.trim().replace(MINUS_SIGNS, '-')
  if (!typed || !/^[+-]?\d+$/.test(typed)) return undefined
  try {
    const exact = BigInt(typed)
    if (BigInt(value) === exact) return undefined
    return exact.toString()
  } catch {
    return undefined
  }
}

function chunkToWords(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`)
    n %= 100
  }
  if (n >= 20) {
    const remainder = n % 10
    parts.push(remainder ? `${TENS[Math.floor(n / 10)]}-${ONES[remainder]}` : TENS[Math.floor(n / 10)])
  } else if (n > 0) {
    parts.push(ONES[n])
  }
  return parts.join(' ')
}

/**
 * A whole number written out in English words. Works from the decimal string
 * so an integer past 2^53 keeps every digit: `12345678901234567890` becomes
 * "twelve quintillion three hundred forty-five quadrillion ..." rather than
 * the rounded double the parser had to store.
 */
export function integerToWords(input: string | bigint): string {
  let digits = typeof input === 'bigint' ? input.toString() : input.trim()
  let negative = false
  if (digits.startsWith('-')) {
    negative = true
    digits = digits.slice(1)
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1)
  }
  if (!/^\d+$/.test(digits)) throw new NumberError('Only whole numbers can be written out')

  const value = BigInt(digits)
  if (value >= MAX_WORDS_VALUE) throw new NumberError('That number is too large to write out')
  if (value === 0n) return 'zero'

  const groups: string[] = []
  let remaining = value
  let scale = 0
  while (remaining > 0n) {
    const part = Number(remaining % 1000n)
    if (part > 0) groups.unshift(`${chunkToWords(part)}${SCALES[scale]}`)
    remaining /= 1000n
    scale += 1
  }
  return (negative ? 'negative ' : '') + groups.join(' ')
}

/**
 * Scientific notation built from a whole number's digits, so a paste past 2^53
 * keeps every significant digit instead of showing the rounded double's.
 */
export function integerToScientific(input: string | bigint): string {
  const text = (typeof input === 'bigint' ? input : BigInt(input)).toString()
  const negative = text.startsWith('-')
  const digits = negative ? text.slice(1) : text
  // The exponent counts every place in the integer; only the mantissa drops
  // trailing zeros, so 1000000 is 1e+6 and not 1e+0.
  const body = digits.replace(/0+$/, '') || '0'
  const mantissa = body.length === 1 ? body : `${body[0]}.${body.slice(1)}`
  return `${negative ? '-' : ''}${mantissa}e+${digits.length - 1}`
}

/** A finite number written out in English words. */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) throw new NumberError('Only finite numbers can be written out')
  if (!Number.isInteger(value)) throw new NumberError('Only whole numbers can be written out')
  const text = value.toString()
  // Huge integers stringify in exponential form; BigInt() reads them exactly.
  return integerToWords(/e/i.test(text) ? BigInt(value) : text)
}

/** Common representations of a value, for the side-by-side list. */
export function representations(value: number, locale = 'en-US', raw?: string): [string, string][] {
  // A pasted integer bigger than 2^53 parses to a nearby double. Show the
  // digits the user actually typed for the rows that would otherwise round.
  const exact = exactIntegerDigits(value, raw)
  const plain = exact ?? String(value)
  const whole = exact != null ? BigInt(exact) : value >= 0 && Number.isInteger(value) ? BigInt(value) : undefined
  // Binary and hex come from the exact integer so a huge paste shows its real
  // bits rather than the rounded double's, and rather than the decimal digits.
  const binary = whole != null && whole >= 0n ? whole.toString(2) : undefined
  const hex = whole != null
    ? (whole < 0n ? `-0x${(-whole).toString(16)}` : `0x${whole.toString(16)}`)
    : undefined
  const rows: [string, string][] = [
    ['Default', formatNumber(value, { locale })],
    ['Plain', plain],
    ['Compact', formatNumber(value, { locale, compact: true })],
    ['Abbreviated', abbreviate(value)],
    ['Currency (USD)', formatNumber(value, { locale, style: 'currency', currency: 'USD' })],
    ['Percent', formatNumber(value, { locale, style: 'percent' })],
    ['Two decimals', formatNumber(value, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 })],
    ['Scientific', exact != null ? integerToScientific(exact) : value.toExponential()],
    ['Binary', binary != null ? binary : '—'],
    ['Hexadecimal', hex != null ? hex : '—'],
  ]
  const words = wordsRow(value, raw)
  if (words) rows.push(['Words', words])
  return rows
}

/**
 * The word form for the side list. When the tool has the exact digits the
 * user typed (a pasted integer too large for a double) we spell those, so the
 * words match the input instead of its rounded approximation.
 */
function wordsRow(value: number, raw?: string): string | undefined {
  const typed = raw?.trim()
  if (typed && /^[+-]?\d+$/.test(typed)) {
    try {
      return integerToWords(typed)
    } catch {
      return undefined
    }
  }
  if (!Number.isInteger(value)) return undefined
  try {
    return numberToWords(value)
  } catch {
    return undefined
  }
}

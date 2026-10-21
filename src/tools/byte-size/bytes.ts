/**
 * Human-readable byte sizes.
 *
 * Decimal units (kB, MB) use powers of 1000; binary units (KiB, MiB) use
 * powers of 1024. The distinction matters: a "1 GB" disk is about 0.93 GiB,
 * and pretending otherwise is where most size bugs come from.
 */

const BINARY = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
const DECIMAL = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB']

/** Group digits the way an English reader expects: 1,234,567. */
const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 })

export interface FormatOptions {
  /** Use powers of 1024 and IEC names instead of powers of 1000 and SI names. */
  binary?: boolean
  /** Digits after the decimal point. */
  decimals?: number
  /** Always show this many significant unit steps, even for whole numbers. */
  fixedUnit?: string
}

export class ByteSizeError extends Error {}

/** Clamp a requested decimal count into the range the formatter supports. */
function clampDecimals(decimals: number | undefined): number {
  if (decimals == null || Number.isNaN(decimals)) return 2
  return Math.max(0, Math.min(10, Math.trunc(decimals)))
}

/**
 * Round to `digits` decimals without ever falling back to exponential
 * notation. `toFixed` switches to "1e+24" above 1e21, which would leak into
 * the output for very large sizes.
 */
function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Format a byte count with a unit suffix. */
export function formatBytes(bytes: number, options: FormatOptions = {}): string {
  if (!Number.isFinite(bytes)) throw new ByteSizeError('Enter a finite number of bytes')
  const binary = options.binary ?? false
  const decimals = clampDecimals(options.decimals)
  const units = binary ? BINARY : DECIMAL
  const step = binary ? 1024 : 1000
  const sign = bytes < 0 ? '-' : ''
  let value = Math.abs(bytes)

  let index = 0
  let label = ''
  if (options.fixedUnit) {
    // A pinned unit may come from either scale, so look in both lists and use
    // the matching scale's step.
    const found = units.indexOf(options.fixedUnit)
    const other = found < 0 ? (binary ? DECIMAL : BINARY).indexOf(options.fixedUnit) : -1
    if (found < 0 && other < 0) throw new ByteSizeError(`Unknown unit "${options.fixedUnit}"`)
    index = found >= 0 ? found : other
    label = options.fixedUnit
    value /= (found >= 0 ? step : binary ? 1000 : 1024) ** index
  } else {
    while (value >= step && index < units.length - 1) {
      value /= step
      index += 1
    }
    label = units[index]
  }

  // Whole bytes never need decimals.
  const digits = index === 0 ? 0 : decimals
  const rounded = roundTo(value, digits)
  return `${sign}${grouped.format(rounded)} ${label}`
}

export interface ParsedSize {
  bytes: number
  /** The unit token the input used, lower-cased; `'b'` when none was given. */
  unit: string
  /** True when the byte count is an integer JavaScript can hold exactly. */
  exact: boolean
}

/**
 * Every spelling the parser accepts, mapped to a byte count.
 *
 * Bits are here as well as bytes: link speeds and transfer quotas are quoted
 * in bits ("100 Mbit"), and silently reading those as bytes would be wrong by
 * a factor of eight.
 */
const UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  k: 1000,
  kb: 1000,
  kilobyte: 1000,
  kilobytes: 1000,
  m: 1000 ** 2,
  mb: 1000 ** 2,
  megabyte: 1000 ** 2,
  megabytes: 1000 ** 2,
  g: 1000 ** 3,
  gb: 1000 ** 3,
  gigabyte: 1000 ** 3,
  gigabytes: 1000 ** 3,
  t: 1000 ** 4,
  tb: 1000 ** 4,
  terabyte: 1000 ** 4,
  terabytes: 1000 ** 4,
  p: 1000 ** 5,
  pb: 1000 ** 5,
  petabyte: 1000 ** 5,
  petabytes: 1000 ** 5,
  e: 1000 ** 6,
  eb: 1000 ** 6,
  kib: 1024,
  kibibyte: 1024,
  kibibytes: 1024,
  mib: 1024 ** 2,
  mebibyte: 1024 ** 2,
  mebibytes: 1024 ** 2,
  gib: 1024 ** 3,
  gibibyte: 1024 ** 3,
  gibibytes: 1024 ** 3,
  tib: 1024 ** 4,
  tebibyte: 1024 ** 4,
  tebibytes: 1024 ** 4,
  pib: 1024 ** 5,
  pebibyte: 1024 ** 5,
  pebibytes: 1024 ** 5,
  eib: 1024 ** 6,
  exbibyte: 1024 ** 6,
  exbibytes: 1024 ** 6,
  bit: 1 / 8,
  bits: 1 / 8,
  kbit: 1000 / 8,
  kbits: 1000 / 8,
  kilobit: 1000 / 8,
  kilobits: 1000 / 8,
  mbit: 1000 ** 2 / 8,
  mbits: 1000 ** 2 / 8,
  megabit: 1000 ** 2 / 8,
  megabits: 1000 ** 2 / 8,
  gbit: 1000 ** 3 / 8,
  gbits: 1000 ** 3 / 8,
  gigabit: 1000 ** 3 / 8,
  gigabits: 1000 ** 3 / 8,
  tbit: 1000 ** 4 / 8,
  tbits: 1000 ** 4 / 8,
  terabit: 1000 ** 4 / 8,
  terabits: 1000 ** 4 / 8,
  kibit: 1024 / 8,
  mibit: 1024 ** 2 / 8,
  gibit: 1024 ** 3 / 8,
  tibit: 1024 ** 4 / 8,
}

/** Strip digit-group separators, but only where they really are separators. */
function normaliseDigits(text: string): string {
  const withoutUnderscores = text.replace(/_/g, '')
  // A comma is a thousands separator only in a group-of-three position; "1,5"
  // is a European decimal comma and is refused rather than silently misread.
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(withoutUnderscores)) {
    return withoutUnderscores.replace(/,/g, '')
  }
  return withoutUnderscores
}

/** Parse strings such as "1.5 MB", "2GiB", "512" or "100 Mbit" into bytes. */
export function parseBytes(input: string): ParsedSize {
  const text = normaliseDigits(input.trim())
  if (!text) throw new ByteSizeError('Enter a size such as "1.5 MB"')
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)$/i.exec(text)
  if (!match) throw new ByteSizeError(`Cannot read "${input.trim()}" as a size — try a number and a unit, like "1.5 MB".`)

  const value = Number(match[1])
  if (Number.isNaN(value)) throw new ByteSizeError(`"${match[1]}" is not a number`)

  const unitText = match[2].toLowerCase()
  if (unitText && !(unitText in UNITS)) {
    throw new ByteSizeError(`Unknown unit "${match[2]}" — try B, kB, KiB, MB, MiB, GB, GiB, TB or TiB.`)
  }
  const multiplier = unitText ? UNITS[unitText] : 1
  const bytes = value * multiplier

  if (!Number.isFinite(bytes)) throw new ByteSizeError('That size is too large to represent — try a smaller number.')
  if (bytes < 0) throw new ByteSizeError('A size cannot be negative — enter a positive number.')

  return { bytes, unit: unitText || 'b', exact: Number.isSafeInteger(bytes) }
}

/** All common representations of one byte count, for side-by-side comparison. */
export function breakdown(bytes: number): { label: string; value: string }[] {
  const bits = bytes * 8
  return [
    { label: 'Bytes', value: Number.isSafeInteger(bytes) ? `${grouped.format(bytes)} B` : `${bytes} B` },
    { label: 'Bits', value: Number.isSafeInteger(bits) ? `${grouped.format(bits)} bit` : `${bits} bit` },
    { label: 'Decimal', value: formatBytes(bytes, { binary: false }) },
    { label: 'Binary', value: formatBytes(bytes, { binary: true }) },
    { label: 'Kilobytes', value: formatBytes(bytes, { fixedUnit: 'kB', decimals: 3 }) },
    { label: 'Kibibytes', value: formatBytes(bytes, { fixedUnit: 'KiB', decimals: 3 }) },
  ]
}

/**
 * How much bigger the decimal label is than the binary one, as a percentage.
 *
 * This is the "a 1 TB drive holds 931 GiB" gap in numbers, so the page can
 * state the size of the discrepancy instead of leaving the reader to subtract
 * two rows. Null when the two scales agree (anything under 1000 bytes).
 */
export function decimalBinaryGap(bytes: number): number | null {
  if (!Number.isFinite(bytes)) return null
  const magnitude = Math.abs(bytes)
  if (magnitude < 1000) return null
  const steps = Math.floor(Math.log(magnitude) / Math.log(1000))
  const clamped = Math.max(1, Math.min(steps, 6))
  return ((1000 / 1024) ** clamped - 1) * 100
}

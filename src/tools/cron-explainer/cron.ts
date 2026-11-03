/** Parse and describe 5-field cron expressions (minute hour dom month dow). */

export interface CronField {
  name: string
  value: string
  description: string
  values: number[]
}

export interface CronResult {
  fields: CronField[]
  description: string
  valid: boolean
  error?: string
  /** The next few run times from a given moment, best-effort within the search window. */
  next: Date[]
  /** True when a valid schedule has no runs inside the search window. */
  exhausted: boolean
  /** Set when the input was a named macro such as `@daily`. */
  macro?: string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const MONTH_ALIASES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const DAY_ALIASES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/** How far ahead the next-run search looks before giving up. */
export const MAX_SEARCH_YEARS = 5

interface FieldSpec {
  name: string
  min: number
  max: number
  names?: string[]
  /** Day-of-week accepts 7 as a synonym for 0 (Sunday). */
  seventhIsZero?: boolean
}

const SPECS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS },
  { name: 'day of week', min: 0, max: 6, names: DAYS, seventhIsZero: true },
]

/** Named schedules crontab itself understands. */
const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

export function macros(): { alias: string; expression: string; description: string }[] {
  return Object.keys(MACROS).map((alias) => ({
    alias,
    expression: MACROS[alias],
    description: parseCron(MACROS[alias]).description,
  }))
}

/** Map a leading `@name` to its 5-field equivalent, or return null. */
export function expandMacro(token: string): string | null {
  return MACROS[token.trim().toLowerCase()] ?? null
}

function substituteNames(part: string, spec: FieldSpec): string {
  const aliases = spec.name === 'month' ? MONTH_ALIASES : spec.name === 'day of week' ? DAY_ALIASES : null
  if (!aliases) return part
  let out = part.toLowerCase()
  for (const [alias, numeric] of Object.entries(aliases)) {
    out = out.replace(new RegExp(`\\b${alias}\\b`, 'g'), String(numeric))
  }
  return out
}

function expand(part: string, spec: FieldSpec): number[] {
  const substituted = substituteNames(part, spec)
  const stepSplit = substituted.split('/')
  if (stepSplit.length > 2) throw new Error(`Too many "/" in "${part}" — a step is written like */5 or 10-20/2`)

  let step = 1
  if (stepSplit[1] !== undefined) {
    step = Number(stepSplit[1])
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`"${part}" has an invalid step — use a whole number of 1 or more, like */5`)
    }
  }

  const upper = spec.seventhIsZero ? 7 : spec.max
  const rangePart = stepSplit[0]
  let start: number
  let end: number
  if (rangePart === '*' || rangePart === '') {
    start = spec.min
    end = spec.max
  } else if (rangePart.includes('-')) {
    const bounds = rangePart.split('-')
    if (bounds.length !== 2 || bounds[0] === '' || bounds[1] === '') {
      throw new Error(`"${part}" is not a valid range — write it like 1-5`)
    }
    start = Number(bounds[0])
    end = Number(bounds[1])
  } else {
    start = Number(rangePart)
    end = start
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`"${part}" is not a number, range, list or step this tool understands`)
  }
  if (start < spec.min || end > upper) {
    const hint = spec.seventhIsZero ? `${spec.min} and ${upper} (7 is Sunday)` : `${spec.min} and ${spec.max}`
    throw new Error(`${spec.name} must be between ${hint} — "${part}" is out of range`)
  }
  if (start > end) throw new Error(`${spec.name} range "${part}" runs backwards — the low value comes first`)

  const values: number[] = []
  for (let value = start; value <= end; value += step) values.push(spec.seventhIsZero && value === 7 ? 0 : value)
  return values
}

export function parseField(raw: string, spec: FieldSpec): CronField {
  const values = new Set<number>()
  for (const part of raw.split(',')) {
    if (!part) throw new Error(`"${raw}" has an empty list item — remove the stray comma`)
    for (const value of expand(part, spec)) values.add(value)
  }
  const sorted = [...values].sort((a, b) => a - b)
  return { name: spec.name, value: raw, description: humanize(raw, sorted, spec), values: sorted }
}

const ANY_PHRASE: Record<string, string> = {
  minute: 'every minute',
  hour: 'every hour',
  'day of month': 'every day',
  month: 'every month',
  'day of week': 'every day of the week',
}

function label(value: number, spec: FieldSpec): string {
  if (spec.name === 'month') return MONTHS[value - 1] ?? String(value)
  if (spec.name === 'day of week') return DAYS[value] ?? String(value)
  return String(value)
}

function humanize(raw: string, values: number[], spec: FieldSpec): string {
  if (raw === '*') return ANY_PHRASE[spec.name]

  const step = raw.match(/^\*\/(\d+)$/)
  if (step) return `every ${step[1]} ${spec.name}s`

  // A plain range reads better as "Monday through Friday" than as a list.
  const range = raw.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (range && spec.names) {
    const from = substituteNames(range[1], spec)
    const to = substituteNames(range[2], spec)
    if (/^\d+$/.test(from) && /^\d+$/.test(to)) {
      const lo = Number(from) === 7 ? 0 : Number(from)
      const hi = Number(to) === 7 ? 0 : Number(to)
      return `${label(lo, spec)} through ${label(hi, spec)}`
    }
  }

  const steppedRange = raw.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)\/(\d+)$/)
  if (steppedRange && spec.names) {
    const from = substituteNames(steppedRange[1], spec)
    const to = substituteNames(steppedRange[2], spec)
    if (/^\d+$/.test(from) && /^\d+$/.test(to)) {
      return `every ${steppedRange[3]} ${spec.name}s from ${label(Number(from), spec)} through ${label(Number(to), spec)}`
    }
  }

  if (spec.names) return values.map((value) => label(value, spec)).join(', ')
  return values.map(String).join(', ')
}

export function parseCron(expression: string): CronResult {
  const raw = expression.trim()
  if (!raw) {
    return { fields: [], description: '', valid: false, error: 'Enter a cron expression, for example 0 9 * * 1-5', next: [], exhausted: false }
  }

  let macro: string | undefined
  let trimmed = raw.replace(/\s+/g, ' ')

  if (trimmed.startsWith('@')) {
    const token = trimmed.split(' ')[0].toLowerCase()
    if (token === '@reboot') {
      return {
        fields: [],
        description: '',
        valid: false,
        error: '@reboot runs when the machine starts, so it has no time schedule to show',
        next: [],
        exhausted: false,
      }
    }
    const mapped = expandMacro(token)
    if (!mapped) {
      return {
        fields: [],
        description: '',
        valid: false,
        error: `Unknown shortcut "${token}" — try @hourly, @daily, @weekly, @monthly or @yearly`,
        next: [],
        exhausted: false,
      }
    }
    macro = token
    trimmed = mapped
  }

  const parts = trimmed.split(' ')
  if (parts.length !== 5) {
    const extra =
      parts.length === 6 || parts.length === 7
        ? ' That looks like a six- or seven-field expression (seconds, or seconds plus year). This tool reads the standard five-field crontab form.'
        : ''
    return {
      fields: [],
      description: '',
      valid: false,
      error: `Cron needs 5 fields — minute, hour, day-of-month, month, day-of-week — but got ${parts.length}.${extra} Try 0 9 * * 1-5.`,
      next: [],
      exhausted: false,
    }
  }

  try {
    const fields = parts.map((part, index) => parseField(part, SPECS[index]))
    const description = fields.map((field, index) => humanize(field.value, field.values, SPECS[index])).join(' · ')
    const next = nextRuns(fields, new Date(), 5)
    return { fields, description, valid: true, next, exhausted: next.length === 0, macro }
  } catch (err) {
    return { fields: [], description: '', valid: false, error: err instanceof Error ? err.message : 'Invalid expression', next: [], exhausted: false, macro }
  }
}

function matches(values: number[], value: number): boolean {
  return values.includes(value)
}

export interface CronNextOptions {
  /** Search window in years. Defaults to MAX_SEARCH_YEARS. */
  maxYears?: number
}

/**
 * Walk forward a minute at a time, skipping whole months, days and hours that
 * cannot match. That keeps a schedule that only fires in a rare year (29 Feb)
 * cheap enough to look several years ahead.
 */
export function nextRuns(fields: CronField[], from: Date, count: number, options: CronNextOptions = {}): Date[] {
  const maxYears = options.maxYears ?? MAX_SEARCH_YEARS
  const [minute, hour, dom, month, dow] = fields
  const results: Date[] = []
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)

  const limit = new Date(cursor.getTime())
  limit.setFullYear(limit.getFullYear() + maxYears)

  const domRestricted = dom.value !== '*'
  const dowRestricted = dow.value !== '*'

  while (results.length < count && cursor.getTime() <= limit.getTime()) {
    if (!matches(month.values, cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }

    const domValue = cursor.getDate()
    const dowValue = cursor.getDay()
    // Vixie cron: when both day fields are restricted, either may match.
    const dayOk =
      domRestricted && dowRestricted
        ? matches(dom.values, domValue) || matches(dow.values, dowValue)
        : domRestricted
          ? matches(dom.values, domValue)
          : dowRestricted
            ? matches(dow.values, dowValue)
            : true

    if (!dayOk) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }

    if (!matches(hour.values, cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }

    if (!matches(minute.values, cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
      continue
    }

    results.push(new Date(cursor.getTime()))
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
  }
  return results
}

const PRESETS: { label: string; expression: string }[] = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { label: 'Hourly', expression: '0 * * * *' },
  { label: 'Daily at midnight', expression: '0 0 * * *' },
  { label: 'Weekdays at 09:00', expression: '0 9 * * 1-5' },
  { label: 'Weekly on Sunday', expression: '0 0 * * 0' },
  { label: 'Monthly on the 1st', expression: '0 0 1 * *' },
  { label: 'First of the year', expression: '@yearly' },
]

export function presets(): { label: string; expression: string }[] {
  return PRESETS
}

/* ------------------------------ visual builder ------------------------------ */

export type Frequency = 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly'

export interface ScheduleSpec {
  frequency: Frequency
  /** Minute of the hour (0–59). */
  minute: number
  /** Hour of the day (0–23). */
  hour: number
  /** Weekday numbers (0 = Sunday) used by the weekly frequency. */
  weekdays: number[]
  /** Day of the month (1–31) used by the monthly frequency. */
  dayOfMonth: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(value) || 0))

/** Turn a structured schedule into a 5-field cron expression. */
export function buildCron(spec: ScheduleSpec): string {
  const minute = clamp(spec.minute, 0, 59)
  const hour = clamp(spec.hour, 0, 23)
  const day = clamp(spec.dayOfMonth, 1, 31)

  switch (spec.frequency) {
    case 'minutely':
      return '* * * * *'
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      const days = [...new Set(spec.weekdays.map((value) => clamp(value, 0, 6)))].sort((a, b) => a - b)
      return `${minute} ${hour} * * ${days.length ? days.join(',') : '*'}`
    }
    case 'monthly':
      return `${minute} ${hour} ${day} * *`
  }
}

/**
 * A plain-language warning for a schedule that looks like a mistake, e.g. a
 * monthly run on the 31st or a day that no month has. Returns null when the
 * schedule is fine.
 */
export function scheduleWarning(expression: string): string | null {
  const result = parseCron(expression)
  if (!result.valid) return null
  if (result.exhausted) {
    return `This schedule has no runs in the next ${MAX_SEARCH_YEARS} years — check the day and month fields.`
  }
  return null
}

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'minutely', label: 'Every minute' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

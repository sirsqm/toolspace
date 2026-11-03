import { describe, expect, it } from 'vitest'
import {
  buildCron,
  expandMacro,
  macros,
  MAX_SEARCH_YEARS,
  nextRuns,
  parseCron,
  parseField,
  scheduleWarning,
  type ScheduleSpec,
} from './cron'

const SPECS = {
  minute: { name: 'minute', min: 0, max: 59 },
  hour: { name: 'hour', min: 0, max: 23 },
  dom: { name: 'day of month', min: 1, max: 31 },
  month: { name: 'month', min: 1, max: 12, names: [] as string[] },
  dow: { name: 'day of week', min: 0, max: 6, names: [] as string[], seventhIsZero: true },
}

describe('parseField', () => {
  it('expands wildcards, ranges, steps and lists', () => {
    expect(parseField('*', SPECS.minute).values).toHaveLength(60)
    expect(parseField('*/15', SPECS.minute).values).toEqual([0, 15, 30, 45])
    expect(parseField('1-5', SPECS.dow).values).toEqual([1, 2, 3, 4, 5])
    expect(parseField('1,15,30', SPECS.minute).values).toEqual([1, 15, 30])
    expect(parseField('10-20/5', SPECS.minute).values).toEqual([10, 15, 20])
  })

  it('accepts single values', () => {
    expect(parseField('30', SPECS.minute).values).toEqual([30])
  })

  it('reads day-of-week 7 as Sunday', () => {
    expect(parseField('7', SPECS.dow).values).toEqual([0])
    expect(parseField('0,7', SPECS.dow).values).toEqual([0])
    expect(parseField('5-7', SPECS.dow).values).toEqual([0, 5, 6])
  })

  it('rejects out-of-range and malformed fields with a usable message', () => {
    expect(() => parseField('60', SPECS.minute)).toThrow(/minute must be between 0 and 59/)
    expect(() => parseField('1/0', SPECS.minute)).toThrow(/invalid step/)
    expect(() => parseField('a', SPECS.minute)).toThrow(/not a number/)
    expect(() => parseField('1,,2', SPECS.minute)).toThrow(/empty list item/)
    expect(() => parseField('9-5', SPECS.dow)).toThrow(/runs backwards/)
    expect(() => parseField('8', SPECS.dow)).toThrow(/0 and 7 \(7 is Sunday\)/)
  })

  it('does not leak month names into other fields', () => {
    // "jan" is only a month; the day-of-month field must reject it.
    expect(() => parseField('jan', SPECS.dom)).toThrow()
    expect(parseField('jan', SPECS.month).values).toEqual([1])
  })
})

describe('parseCron', () => {
  it('describes a common schedule', () => {
    const result = parseCron('0 9 * * 1-5')
    expect(result.valid).toBe(true)
    expect(result.description).toContain('Monday through Friday')
  })

  it('rejects the wrong number of fields with a helpful hint', () => {
    const result = parseCron('* * *')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('needs 5 fields')
  })

  it('explains a six-field expression', () => {
    const result = parseCron('0 0 9 * * 1-5')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/six- or seven-field/)
  })

  it('reports an empty expression with an example', () => {
    const result = parseCron('  ')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/0 9 \* \* 1-5/)
  })

  it('gives a human phrase for plain wildcards', () => {
    expect(parseCron('* * * * *').description).toBe('every minute · every hour · every day · every month · every day of the week')
  })

  it('accepts named macros', () => {
    const daily = parseCron('@daily')
    expect(daily.valid).toBe(true)
    expect(daily.macro).toBe('@daily')
    expect(daily.description).toBe(parseCron('0 0 * * *').description)
    expect(parseCron('@weekly').valid).toBe(true)
  })

  it('rejects @reboot and unknown macros with a specific message', () => {
    expect(parseCron('@reboot').error).toMatch(/no time schedule/)
    expect(parseCron('@fortnightly').error).toMatch(/Unknown shortcut/)
  })

  it('expands macros to their five-field form', () => {
    expect(expandMacro('@yearly')).toBe('0 0 1 1 *')
    expect(expandMacro('@HOURLY')).toBe('0 * * * *')
    expect(expandMacro('@nope')).toBeNull()
  })

  it('lists every macro with a description', () => {
    const list = macros()
    expect(list.length).toBeGreaterThan(0)
    for (const macro of list) expect(macro.description).toBeTruthy()
  })
})

describe('nextRuns', () => {
  it('finds the next daily midnight', () => {
    const fields = parseCron('0 0 * * *').fields
    const from = new Date('2024-05-01T10:30:00')
    const next = nextRuns(fields, from, 3)
    expect(next).toHaveLength(3)
    expect(next[0].getHours()).toBe(0)
    expect(next[0].getMinutes()).toBe(0)
    expect(next[2].getTime() - next[0].getTime()).toBe(2 * 24 * 60 * 60 * 1000)
  })

  it('respects weekdays-only schedules', () => {
    const fields = parseCron('0 9 * * 1-5').fields
    const next = nextRuns(fields, new Date('2024-05-03T12:00:00'), 4) // Friday afternoon
    expect(next.map((date) => date.getDay())).toEqual([1, 2, 3, 4]) // Mon-Thu
  })

  it('finds a leap-day schedule that is years away', () => {
    const fields = parseCron('0 0 29 2 *').fields
    const next = nextRuns(fields, new Date('2025-03-01T00:00:00'), 1)
    expect(next).toHaveLength(1)
    expect(next[0].getMonth()).toBe(1)
    expect(next[0].getDate()).toBe(29)
    expect(next[0].getFullYear()).toBe(2028)
  })

  it('reports no runs when the schedule never fires in the window', () => {
    const fields = parseCron('0 0 30 2 *').fields
    expect(nextRuns(fields, new Date('2024-01-01T00:00:00'), 1)).toEqual([])
  })

  it('keeps a minutely schedule quick', () => {
    const fields = parseCron('* * * * *').fields
    const started = Date.now()
    expect(nextRuns(fields, new Date('2024-05-01T10:30:00'), 5)).toHaveLength(5)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('parseCron exhaustion', () => {
  it('flags a valid schedule with no runs', () => {
    const result = parseCron('0 0 30 2 *')
    expect(result.valid).toBe(true)
    expect(result.exhausted).toBe(true)
    expect(result.next).toHaveLength(0)
  })

  it('does not flag an ordinary schedule', () => {
    expect(parseCron('0 9 * * 1-5').exhausted).toBe(false)
  })
})

describe('scheduleWarning', () => {
  it('warns about an impossible day', () => {
    expect(scheduleWarning('0 0 30 2 *')).toMatch(new RegExp(`next ${MAX_SEARCH_YEARS} years`))
  })

  it('stays quiet for a normal schedule and for invalid input', () => {
    expect(scheduleWarning('0 9 * * 1-5')).toBeNull()
    expect(scheduleWarning('nonsense')).toBeNull()
  })
})

describe('buildCron', () => {
  const base: ScheduleSpec = { frequency: 'daily', minute: 30, hour: 8, weekdays: [1], dayOfMonth: 1 }

  it('builds each frequency', () => {
    expect(buildCron({ ...base, frequency: 'minutely' })).toBe('* * * * *')
    expect(buildCron({ ...base, frequency: 'hourly' })).toBe('30 * * * *')
    expect(buildCron({ ...base, frequency: 'daily' })).toBe('30 8 * * *')
    expect(buildCron({ ...base, frequency: 'monthly', dayOfMonth: 15 })).toBe('30 8 15 * *')
  })

  it('lists weekdays sorted and de-duplicated', () => {
    expect(buildCron({ ...base, frequency: 'weekly', weekdays: [5, 1, 1, 3] })).toBe('30 8 * * 1,3,5')
    expect(buildCron({ ...base, frequency: 'weekly', weekdays: [] })).toBe('30 8 * * *')
  })

  it('clamps out-of-range values', () => {
    expect(buildCron({ ...base, frequency: 'daily', minute: 99, hour: -5 })).toBe('59 0 * * *')
    expect(buildCron({ ...base, frequency: 'monthly', dayOfMonth: 99 })).toBe('30 8 31 * *')
  })

  it('produces expressions the parser accepts', () => {
    const expressions = ['minutely', 'hourly', 'daily', 'weekly', 'monthly'].map((frequency) =>
      buildCron({ ...base, frequency: frequency as ScheduleSpec['frequency'] }),
    )
    for (const expression of expressions) {
      expect(parseCron(expression).valid).toBe(true)
    }
  })
})

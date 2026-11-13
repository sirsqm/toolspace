import { describe, expect, it } from 'vitest'
import {
  attributeEntries,
  CookieError,
  formatAttributes,
  isExpired,
  MAX_COOKIE_BYTES,
  parseCookieHeader,
  parseSetCookie,
  parseSetCookieBlock,
  serialise,
  summarise,
} from './cookie'

const NOW = Date.parse('2024-01-01T00:00:00Z')

describe('parseSetCookie', () => {
  it('parses a name and value', () => {
    const cookie = parseSetCookie('session=abc123', NOW)
    expect(cookie.name).toBe('session')
    expect(cookie.value).toBe('abc123')
  })

  it('parses attributes case-insensitively', () => {
    const cookie = parseSetCookie('a=1; Domain=example.com; Path=/app; secure; HTTPONLY; SameSite=lax', NOW)
    expect(cookie.attributes.domain).toBe('example.com')
    expect(cookie.attributes.path).toBe('/app')
    expect(cookie.attributes.secure).toBe(true)
    expect(cookie.attributes.httpOnly).toBe(true)
    expect(cookie.attributes.sameSite).toBe('Lax')
  })

  it('parses Max-Age and Expires', () => {
    const cookie = parseSetCookie('a=1; Max-Age=3600; Expires=Wed, 01 Jan 2025 00:00:00 GMT', NOW)
    expect(cookie.attributes.maxAge).toBe(3600)
    expect(cookie.attributes.expires?.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })

  it('keeps unknown attributes', () => {
    const cookie = parseSetCookie('a=1; Priority=High; Foo', NOW)
    expect(cookie.attributes.extra).toEqual([['priority', 'High'], ['foo', '']])
  })

  it('marks a negative Max-Age as expired', () => {
    expect(parseSetCookie('a=1; Max-Age=0', NOW).expired).toBe(true)
  })

  it('marks a past Expires as expired', () => {
    expect(parseSetCookie('a=1; Expires=Wed, 01 Jan 2020 00:00:00 GMT', NOW).expired).toBe(true)
  })

  it('rejects a line without name=value', () => {
    expect(() => parseSetCookie('justtext', NOW)).toThrow(CookieError)
    expect(() => parseSetCookie('', NOW)).toThrow(CookieError)
  })
})

describe('audit issues', () => {
  it('flags missing Secure and HttpOnly', () => {
    const messages = parseSetCookie('a=1', NOW).issues.map((i) => i.message).join(' ')
    expect(messages).toMatch(/Secure/)
    expect(messages).toMatch(/HttpOnly/)
  })

  it('treats SameSite=None without Secure as an error', () => {
    const issues = parseSetCookie('a=1; SameSite=None', NOW).issues
    expect(issues.some((i) => i.level === 'error' && /SameSite=None/.test(i.message))).toBe(true)
  })

  it('accepts SameSite=None with Secure', () => {
    const issues = parseSetCookie('a=1; SameSite=None; Secure', NOW).issues
    expect(issues.some((i) => /SameSite=None/.test(i.message))).toBe(false)
  })

  it('enforces the __Host- prefix rules', () => {
    const issues = parseSetCookie('__Host-a=1; Path=/; Secure', NOW).issues
    expect(issues.some((i) => /HttpOnly/.test(i.message))).toBe(true)
    const bad = parseSetCookie('__Host-a=1; Domain=example.com; Path=/x; Secure', NOW).issues
    expect(bad.filter((i) => i.level === 'error')).toHaveLength(2)
  })

  it('enforces the __Secure- prefix rule', () => {
    const issues = parseSetCookie('__Secure-a=1', NOW).issues
    expect(issues.some((i) => i.level === 'error' && /__Secure-/.test(i.message))).toBe(true)
  })

  it('reports a leading dot on Domain as informational', () => {
    const issues = parseSetCookie('a=1; Domain=.example.com', NOW).issues
    expect(issues.some((i) => /leading dot/.test(i.message))).toBe(true)
  })
})

describe('parseCookieHeader', () => {
  it('parses request cookies', () => {
    expect(parseCookieHeader('a=1; b=two')).toEqual([{ name: 'a', value: '1' }, { name: 'b', value: 'two' }])
  })

  it('decodes percent-encoding', () => {
    expect(parseCookieHeader('a=hello%20world')[0].value).toBe('hello world')
  })

  it('drops empty segments', () => {
    expect(parseCookieHeader('a=1;;')).toHaveLength(1)
  })
})

describe('parseSetCookieBlock', () => {
  it('parses one cookie per line', () => {
    const block = 'a=1; Secure\nb=2; HttpOnly'
    expect(parseSetCookieBlock(block, NOW).map((c) => c.name)).toEqual(['a', 'b'])
  })
})

describe('serialise', () => {
  it('round-trips a cookie', () => {
    const original = 'session=abc; Domain=example.com; Path=/app; SameSite=Lax; Secure; HttpOnly'
    const cookie = parseSetCookie(original, NOW)
    const line = serialise(cookie)
    const again = parseSetCookie(line, NOW)
    expect(again.name).toBe(cookie.name)
    expect(again.attributes).toEqual(cookie.attributes)
  })
})

describe('formatAttributes', () => {
  it('prints a human-readable list', () => {
    const lines = formatAttributes(parseSetCookie('a=1; Secure; SameSite=Strict', NOW))
    expect(lines).toContain('Secure: yes')
    expect(lines).toContain('SameSite: Strict')
    expect(lines).toContain('HttpOnly: no')
  })
})

describe('isExpired', () => {
  it('is false with no expiry information', () => {
    expect(isExpired(parseSetCookie('a=1', NOW).attributes, NOW)).toBe(false)
  })
})

describe('input validation issues', () => {
  it('flags an illegal cookie name as an error', () => {
    const issues = parseSetCookie('bad name=1', NOW).issues
    expect(issues.some((i) => i.level === 'error' && i.attribute === 'name')).toBe(true)
  })

  it('flags an illegal cookie value as a warning', () => {
    const issues = parseSetCookie('a=has space', NOW).issues
    expect(issues.some((i) => i.level === 'warn' && i.attribute === 'value')).toBe(true)
  })

  it('accepts a legal cookie-octet value', () => {
    const issues = parseSetCookie('a=abc123-_.~', NOW).issues
    expect(issues.some((i) => i.attribute === 'value')).toBe(false)
  })

  it('reports an unreadable Expires date', () => {
    const issues = parseSetCookie('a=1; Expires=not-a-date', NOW).issues
    expect(issues.some((i) => i.attribute === 'Expires' && i.level === 'warn')).toBe(true)
  })

  it('reports a non-numeric Max-Age', () => {
    const issues = parseSetCookie('a=1; Max-Age=soon', NOW).issues
    expect(issues.some((i) => i.attribute === 'Max-Age' && i.level === 'warn')).toBe(true)
  })

  it('reports an unknown SameSite value', () => {
    const cookie = parseSetCookie('a=1; SameSite=Sideways', NOW)
    expect(cookie.attributes.sameSite).toBe('unknown')
    expect(cookie.issues.some((i) => i.attribute === 'SameSite' && /Sideways/.test(i.message))).toBe(true)
  })

  it('warns when a path does not start with a slash', () => {
    const issues = parseSetCookie('a=1; Path=app', NOW).issues
    expect(issues.some((i) => i.attribute === 'Path')).toBe(true)
  })

  it('flags Partitioned without Secure as an error', () => {
    const issues = parseSetCookie('a=1; Partitioned', NOW).issues
    expect(issues.some((i) => i.level === 'error' && i.attribute === 'Partitioned')).toBe(true)
  })

  it('warns when the line exceeds the browser size limit', () => {
    const big = `a=${'x'.repeat(MAX_COOKIE_BYTES)}`
    const issues = parseSetCookie(big, NOW).issues
    expect(issues.some((i) => i.attribute === 'size')).toBe(true)
    expect(parseSetCookie(`a=${'x'.repeat(MAX_COOKIE_BYTES - 200)}`, NOW).issues.some((i) => i.attribute === 'size')).toBe(false)
  })

  it('records the byte size of the line', () => {
    expect(parseSetCookie('a=1; Secure', NOW).size).toBe(11)
  })
})

describe('summarise', () => {
  it('counts issues and picks the worst verdict', () => {
    const cookies = parseSetCookieBlock('a=1; SameSite=None\nb=1; Secure; HttpOnly; SameSite=Lax', NOW)
    const summary = summarise(cookies)
    expect(summary.cookies).toBe(2)
    expect(summary.errors).toBeGreaterThan(0)
    expect(summary.verdict).toBe('error')
    expect(summary.perCookie[0]).toBe('error')
  })

  it('returns ok when every cookie is clean', () => {
    const summary = summarise(parseSetCookieBlock('b=1; Secure; HttpOnly; SameSite=Lax', NOW))
    expect(summary.errors).toBe(0)
    expect(summary.warnings).toBe(0)
    expect(summary.verdict).toBe('ok')
    expect(summary.perCookie).toEqual(['ok'])
  })

  it('is empty for no cookies', () => {
    expect(summarise([])).toEqual({ cookies: 0, errors: 0, warnings: 0, infos: 0, verdict: 'ok', perCookie: [] })
  })
})

describe('attributeEntries', () => {
  it('lists set attributes with readable values', () => {
    const entries = attributeEntries(parseSetCookie('a=1; Domain=example.com; Max-Age=60; Secure', NOW))
    const byLabel = Object.fromEntries(entries.map((e) => [e.label, e.value]))
    expect(byLabel.Domain).toBe('example.com')
    expect(byLabel['Max-Age']).toBe('60 seconds')
    expect(byLabel.Secure).toBe('yes')
    expect(byLabel.HttpOnly).toBe('no')
  })

  it('shows a bare flag attribute as "(flag)"', () => {
    const entries = attributeEntries(parseSetCookie('a=1; Foo', NOW))
    expect(entries).toContainEqual({ label: 'foo', value: '(flag)' })
  })
})

describe('parseSetCookieBlock', () => {
  it('ignores blank lines and trims', () => {
    expect(parseSetCookieBlock('  a=1; Secure  \n\n  b=2  ', NOW).map((c) => c.name)).toEqual(['a', 'b'])
  })
})

describe('parseCookieHeader', () => {
  it('keeps a value that fails to percent-decode verbatim', () => {
    expect(parseCookieHeader('a=%E0%A4%A')[0].value).toBe('%E0%A4%A')
  })

  it('treats a bare name as an empty value', () => {
    expect(parseCookieHeader('flag')).toEqual([{ name: 'flag', value: '' }])
  })
})

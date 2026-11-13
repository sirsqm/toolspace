/**
 * Parsing and auditing of HTTP cookies.
 *
 * `Set-Cookie` lines are parsed into their value plus attributes, then checked
 * for the flags browsers and auditors care about. A `Cookie` request header is
 * parsed separately because it carries names and values only.
 */

export interface CookieAttributes {
  domain?: string
  path?: string
  expires?: Date
  maxAge?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None' | 'unknown'
  partitioned: boolean
  /** Any other attribute, kept verbatim. */
  extra: [string, string][]
}

export interface ParsedCookie {
  name: string
  value: string
  attributes: CookieAttributes
  /** Whether the cookie is already expired, given the supplied clock. */
  expired: boolean
  issues: Issue[]
  /** Length of the source line, so the size limit can be reported. */
  size: number
}

export interface Issue {
  level: 'error' | 'warn' | 'info'
  message: string
  /** The attribute the issue is about, e.g. "Secure". Undefined for the cookie as a whole. */
  attribute?: string
}

export class CookieError extends Error {}

/** Most browsers refuse to store a cookie whose whole line exceeds 4096 bytes. */
export const MAX_COOKIE_BYTES = 4096

// RFC 6265 cookie-octet: %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E.
// Anything outside that set — controls, space, DQUOTE, comma, semicolon,
// backslash and non-ASCII — is not legal in a cookie value.
const INVALID_VALUE = /[\x00-\x20\x22\x2c\x3b\x5c\x7f-\uffff]/
// A cookie name must be a token: no separators, whitespace or controls.
const INVALID_NAME = /[()<>@,;:\\"/[\]?={} \t\x00-\x1f\x7f]/

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function emptyAttributes(): CookieAttributes {
  return { secure: false, httpOnly: false, partitioned: false, extra: [] }
}

/** Reasons a name is not a legal cookie token, as plain sentences. */
function nameIssues(name: string): Issue[] {
  if (INVALID_NAME.test(name)) {
    return [
      {
        level: 'error',
        attribute: 'name',
        message: 'The cookie name contains a character that is not allowed (separators, spaces and control characters are forbidden).',
      },
    ]
  }
  return []
}

/** Reasons a value is not a legal cookie-octet string, as plain sentences. */
function valueIssues(value: string): Issue[] {
  if (INVALID_VALUE.test(value)) {
    return [
      {
        level: 'warn',
        attribute: 'value',
        message: 'The value contains a character that is not a legal cookie-octet (space, quote, comma, semicolon, backslash or a non-ASCII character).',
      },
    ]
  }
  return []
}

export function parseSetCookie(line: string, now: number = Date.now()): ParsedCookie {
  const text = line.trim()
  if (!text) throw new CookieError('Empty Set-Cookie line.')
  const segments = text.split(';')
  const first = segments.shift() ?? ''
  const eq = first.indexOf('=')
  if (eq < 0) throw new CookieError(`Expected name=value, got "${first.trim()}".`)
  const name = first.slice(0, eq).trim()
  if (!name) throw new CookieError('The cookie name is empty.')
  const value = first.slice(eq + 1).trim()

  const attributes = emptyAttributes()
  // Problems found while reading the attributes, kept separate from the
  // security audit so the two concerns stay readable.
  const parseIssues: Issue[] = [...nameIssues(name), ...valueIssues(value)]
  for (const raw of segments) {
    const segment = raw.trim()
    if (!segment) continue
    const index = segment.indexOf('=')
    const key = (index < 0 ? segment : segment.slice(0, index)).trim().toLowerCase()
    const attrValue = index < 0 ? '' : segment.slice(index + 1).trim()
    switch (key) {
      case 'domain':
        attributes.domain = attrValue
        break
      case 'path':
        attributes.path = attrValue
        break
      case 'expires': {
        const date = new Date(attrValue)
        if (!Number.isNaN(date.getTime())) attributes.expires = date
        else {
          parseIssues.push({
            level: 'warn',
            attribute: 'Expires',
            message: `Expires="${attrValue}" is not a date this browser can read, so it will be ignored.`,
          })
        }
        break
      }
      case 'max-age': {
        const seconds = Number(attrValue)
        if (Number.isFinite(seconds)) attributes.maxAge = seconds
        else {
          parseIssues.push({
            level: 'warn',
            attribute: 'Max-Age',
            message: `Max-Age="${attrValue}" is not a number, so it will be ignored.`,
          })
        }
        break
      }
      case 'secure':
        attributes.secure = true
        break
      case 'httponly':
        attributes.httpOnly = true
        break
      case 'samesite': {
        const normalised = attrValue.charAt(0).toUpperCase() + attrValue.slice(1).toLowerCase()
        attributes.sameSite = normalised === 'Strict' || normalised === 'Lax' || normalised === 'None' ? normalised : 'unknown'
        if (attributes.sameSite === 'unknown') {
          parseIssues.push({
            level: 'warn',
            attribute: 'SameSite',
            message: `SameSite="${attrValue}" is not one of Strict, Lax or None, so browsers treat the cookie as if it had no SameSite value.`,
          })
        }
        break
      }
      case 'partitioned':
        attributes.partitioned = true
        break
      default:
        attributes.extra.push([key || segment, attrValue])
    }
  }

  const expired = isExpired(attributes, now)
  const issues = [...parseIssues, ...audit(name, attributes, expired)]
  if (text.length > MAX_COOKIE_BYTES) {
    issues.push({
      level: 'warn',
      attribute: 'size',
      message: `This line is ${text.length} bytes, over the ${MAX_COOKIE_BYTES}-byte limit most browsers enforce, so the cookie may be dropped.`,
    })
  }
  return { name, value, attributes, expired, issues, size: text.length }
}

export function isExpired(attributes: CookieAttributes, now: number = Date.now()): boolean {
  if (attributes.maxAge !== undefined && attributes.maxAge <= 0) return true
  if (attributes.expires && attributes.expires.getTime() <= now) return true
  return false
}

function audit(name: string, attributes: CookieAttributes, expired: boolean): Issue[] {
  const issues: Issue[] = []
  const lowerName = name.toLowerCase()

  if (!attributes.secure) {
    issues.push({ level: 'warn', attribute: 'Secure', message: 'Missing the Secure flag — this cookie can travel over plain HTTP.' })
  }
  if (!attributes.httpOnly) {
    issues.push({ level: 'warn', attribute: 'HttpOnly', message: 'Missing HttpOnly — JavaScript on the page can read this cookie.' })
  }
  if (attributes.sameSite === 'None' && !attributes.secure) {
    issues.push({ level: 'error', attribute: 'SameSite', message: 'SameSite=None requires Secure, or browsers will reject the cookie.' })
  }
  if (!attributes.sameSite) {
    issues.push({ level: 'info', attribute: 'SameSite', message: 'No SameSite attribute — modern browsers default to Lax.' })
  }
  if (attributes.partitioned && !attributes.secure) {
    issues.push({ level: 'error', attribute: 'Partitioned', message: 'Partitioned requires the Secure flag, or browsers will reject the cookie.' })
  }
  if (lowerName.startsWith('__secure-') && !attributes.secure) {
    issues.push({ level: 'error', attribute: 'name', message: 'The __Secure- prefix requires the Secure flag.' })
  }
  if (lowerName.startsWith('__host-')) {
    if (!attributes.secure) issues.push({ level: 'error', attribute: 'name', message: 'The __Host- prefix requires the Secure flag.' })
    if (attributes.domain) issues.push({ level: 'error', attribute: 'Domain', message: 'The __Host- prefix forbids a Domain attribute.' })
    if (attributes.path !== '/') issues.push({ level: 'error', attribute: 'Path', message: 'The __Host- prefix requires Path=/' })
  }
  if (attributes.path !== undefined && !attributes.path.startsWith('/')) {
    issues.push({ level: 'warn', attribute: 'Path', message: `Path="${attributes.path}" does not start with "/", so browsers use the default path instead.` })
  }
  if (expired) issues.push({ level: 'info', attribute: 'Expires', message: 'This cookie is expired and would be deleted by the browser.' })
  if (attributes.domain?.startsWith('.')) {
    issues.push({ level: 'info', attribute: 'Domain', message: 'A leading dot in Domain is ignored by modern browsers.' })
  }
  return issues
}

/** Parse a `Cookie:` request header into pairs. */
export function parseCookieHeader(header: string): { name: string; value: string }[] {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=')
      if (eq < 0) return { name: part, value: '' }
      return { name: part.slice(0, eq).trim(), value: decode(part.slice(eq + 1).trim()) }
    })
    .filter((pair) => pair.name !== '')
}

/** Parse a full header block, one Set-Cookie per line. */
export function parseSetCookieBlock(block: string, now: number = Date.now()): ParsedCookie[] {
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSetCookie(line, now))
}

/** Render a parsed cookie back to a Set-Cookie line. */
export function serialise(cookie: ParsedCookie): string {
  const parts = [`${cookie.name}=${cookie.value}`]
  const a = cookie.attributes
  if (a.domain) parts.push(`Domain=${a.domain}`)
  if (a.path) parts.push(`Path=${a.path}`)
  if (a.expires) parts.push(`Expires=${a.expires.toUTCString()}`)
  if (a.maxAge !== undefined) parts.push(`Max-Age=${a.maxAge}`)
  if (a.sameSite && a.sameSite !== 'unknown') parts.push(`SameSite=${a.sameSite}`)
  if (a.secure) parts.push('Secure')
  if (a.httpOnly) parts.push('HttpOnly')
  if (a.partitioned) parts.push('Partitioned')
  for (const [key, value] of a.extra) parts.push(value ? `${key}=${value}` : key)
  return parts.join('; ')
}

export interface AttributeEntry {
  label: string
  value: string
}

/** The attributes of a cookie as label/value pairs, for display. */
export function attributeEntries(cookie: ParsedCookie): AttributeEntry[] {
  const a = cookie.attributes
  const entries: AttributeEntry[] = []
  if (a.domain) entries.push({ label: 'Domain', value: a.domain })
  if (a.path) entries.push({ label: 'Path', value: a.path })
  if (a.expires) entries.push({ label: 'Expires', value: a.expires.toUTCString() })
  if (a.maxAge !== undefined) entries.push({ label: 'Max-Age', value: `${a.maxAge} seconds` })
  if (a.sameSite) entries.push({ label: 'SameSite', value: a.sameSite })
  entries.push({ label: 'Secure', value: a.secure ? 'yes' : 'no' })
  entries.push({ label: 'HttpOnly', value: a.httpOnly ? 'yes' : 'no' })
  if (a.partitioned) entries.push({ label: 'Partitioned', value: 'yes' })
  for (const [key, value] of a.extra) entries.push({ label: key, value: value || '(flag)' })
  return entries
}

/** Render the attributes of a cookie as human-readable lines. */
export function formatAttributes(cookie: ParsedCookie): string[] {
  return attributeEntries(cookie).map((entry) => `${entry.label}: ${entry.value}`)
}

export type Verdict = 'ok' | 'warn' | 'error'

export interface AuditSummary {
  cookies: number
  errors: number
  warnings: number
  infos: number
  /** The worst level across every cookie. */
  verdict: Verdict
  /** The level to show on a single cookie's card. */
  perCookie: Verdict[]
}

/** Roll a set of parsed cookies up into counts and an overall verdict. */
export function summarise(cookies: ParsedCookie[]): AuditSummary {
  let errors = 0
  let warnings = 0
  let infos = 0
  const perCookie: Verdict[] = cookies.map((cookie) => {
    let verdict: Verdict = 'ok'
    for (const issue of cookie.issues) {
      if (issue.level === 'error') {
        errors += 1
        verdict = 'error'
      } else if (issue.level === 'warn') {
        warnings += 1
        if (verdict !== 'error') verdict = 'warn'
      } else {
        infos += 1
      }
    }
    return verdict
  })
  const verdict: Verdict = errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok'
  return { cookies: cookies.length, errors, warnings, infos, verdict, perCookie }
}

/** A few well-known cookie lines, handy as one-click examples. */
export const EXAMPLES: { label: string; value: string }[] = [
  { label: 'Hardened session', value: 'session=abc123; Domain=example.com; Path=/; SameSite=Lax; Secure; HttpOnly' },
  { label: 'Tracking cookie', value: 'tracker=9f8e; Path=/; Expires=Wed, 01 Jan 2027 00:00:00 GMT; SameSite=None' },
  { label: 'Cookie request header', value: 'session=abc123; theme=dark' },
]

/** Escape and unescape a string for many common contexts. */

export type Flavor = 'json' | 'js' | 'html' | 'xml' | 'url' | 'sql' | 'shell' | 'regex' | 'csv'

/** Thrown when text cannot be unescaped for the selected flavour. */
export class EscapeError extends Error {}

export interface FlavorMeta {
  value: Flavor
  label: string
}

export const FLAVORS: FlavorMeta[] = [
  { value: 'json', label: 'JSON' },
  { value: 'js', label: 'JavaScript' },
  { value: 'html', label: 'HTML' },
  { value: 'xml', label: 'XML' },
  { value: 'url', label: 'URL component' },
  { value: 'sql', label: 'SQL' },
  { value: 'shell', label: 'Shell (single quotes)' },
  { value: 'regex', label: 'Regex' },
  { value: 'csv', label: 'CSV field' },
]

/** One plain-English sentence per flavour, shown as a hint under the picker. */
export const FLAVOR_NOTES: Record<Flavor, string> = {
  json: 'Escapes the inside of a JSON string — the quotes that wrap it are yours to add.',
  js: 'Escapes the inside of a JavaScript string literal.',
  html: "Replaces the five characters that break HTML markup: & < > \" and '.",
  xml: 'Same five characters as HTML, for XML documents.',
  url: 'Percent-encodes one URL component, such as a query value or path segment.',
  sql: 'Doubles single quotes for a SQL string literal.',
  shell: 'Wraps the text in single quotes for a POSIX shell, escaping any quote inside.',
  regex: 'Escapes regular-expression metacharacters so the text matches literally.',
  csv: 'Quotes a CSV field when it needs it, and defuses a leading = + - @ formula.',
}

/** A short, realistic sample per flavour for the "Load example" button. */
export const EXAMPLES: Record<Flavor, string> = {
  json: 'He said "hi"\nand left.',
  js: 'He said "hi"\nand left.',
  html: '<a href="?q=1&x=2">Tom & Jerry\'s</a>',
  xml: '<note id="1">a & b</note>',
  url: 'a b/c?d=e&f=1',
  sql: "SELECT * FROM t WHERE name = 'O'Brien'",
  shell: 'echo "it\'s $HOME"',
  regex: 'file (1).txt?',
  csv: 'Smith, John',
}

const HTML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g

export function escape(text: string, flavor: Flavor): string {
  switch (flavor) {
    case 'json':
    case 'js':
      return JSON.stringify(text).slice(1, -1)
    case 'html':
    case 'xml':
      return text.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c])
    case 'url':
      return encodeURIComponent(text)
    case 'sql':
      return text.replace(/'/g, "''")
    case 'shell':
      return `'${text.replace(/'/g, `'\\''`)}'`
    case 'regex':
      return text.replace(REGEX_SPECIAL, '\\$&')
    case 'csv': {
      // Spreadsheet apps treat a leading = + - @ as a formula, so neutralise it.
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
      return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
    }
    default:
      return text
  }
}

export function unescape(text: string, flavor: Flavor): string {
  switch (flavor) {
    case 'json':
    case 'js':
      return decodeStringBody(text)
    case 'html':
    case 'xml':
      return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
        if (body[0] === '#') {
          const hex = body[1] === 'x' || body[1] === 'X'
          const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
          // A lone surrogate or a value past U+10FFFF is not a character; leave
          // the entity alone rather than emitting a replacement char.
          if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
          if (code >= 0xd800 && code <= 0xdfff) return whole
          return String.fromCodePoint(code)
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? whole
      })
    case 'url':
      try {
        return decodeURIComponent(text)
      } catch {
        throw new EscapeError('That is not valid percent-encoding — a % must be followed by two hex digits.')
      }
    case 'sql':
      return text.replace(/''/g, "'")
    case 'shell': {
      const trimmed = text.trim()
      if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1).replace(/'\\''/g, "'")
      }
      return text
    }
    case 'regex':
      return text.replace(/\\([.*+?^${}()|[\]\\/])/g, '$1')
    case 'csv': {
      const trimmed = text.trim()
      const inner = trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"') : trimmed
      return inner.startsWith("'") && /^'[=+\-@]/.test(inner) ? inner.slice(1) : inner
    }
    default:
      return text
  }
}

/** Decode a JSON/JS string body, reporting a useful message on malformed input. */
function decodeStringBody(text: string): string {
  try {
    return JSON.parse(`"${text.replace(/"/g, '\\"')}"`)
  } catch {
    try {
      return JSON.parse(`"${text.replace(/(?<!\\)"/g, '\\"')}"`)
    } catch {
      throw new EscapeError('That is not a valid JSON string — check for a trailing backslash or a control character.')
    }
  }
}

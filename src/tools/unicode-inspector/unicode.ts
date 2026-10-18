/**
 * Per-character Unicode inspection and HTML entity encode/decode.
 *
 * Everything here is pure: it takes a string and returns plain data, so the
 * DOM layer in `index.ts` stays a paint job. `inspect` is bounded by a limit
 * because a careless paste can otherwise allocate one record per character.
 */

export interface CharInfo {
  char: string
  codePoint: number
  /** Inclusive UTF-16 index of the first code unit. */
  index: number
  /** Uppercase hex, e.g. "1F600". */
  hex: string
  decimal: string
  /** U+XXXX form. */
  unicode: string
  /** \uXXXX or \u{XXXXX} escape for JS string literals. */
  js: string
  /** HTML numeric entity. */
  html: string
  /** UTF-8 bytes as space-separated hex, e.g. "F0 9F 98 80". */
  utf8: string
  utf8Length: number
  /** Unicode general category, e.g. "Uppercase letter (Lu)". */
  category: string
  /** A visible stand-in for characters that print nothing, e.g. "␠". */
  display: string
  /** The Unicode name, when it is one we know. */
  name: string
}

const NAMED: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
}

export function encodeHtml(input: string): string {
  return [...input]
    .map((char) => {
      if (NAMED[char]) return NAMED[char]
      const code = char.codePointAt(0) ?? 0
      return code > 127 ? `&#${code};` : char
    })
    .join('')
}

/**
 * Named references understood when decoding. Kept to the characters that show
 * up in real documents; anything else is left exactly as written, so a typo is
 * visible rather than silently swallowed.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷',
  micro: 'µ', para: '¶', sect: '§', middot: '·', bull: '•', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', dagger: '†', permil: '‰', prime: '′', infin: '∞',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', crarr: '↵',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', sup1: '¹',
  szlig: 'ß', agrave: 'à', aacute: 'á', auml: 'ä', aring: 'å', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', iacute: 'í', iuml: 'ï',
  ntilde: 'ñ', oacute: 'ó', ouml: 'ö', oslash: 'ø', uacute: 'ú', uuml: 'ü',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', Aring: 'Å', Ccedil: 'Ç',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', sigma: 'σ', omega: 'ω',
  sum: '∑', prod: '∏', radic: '√', ne: '≠', le: '≤', ge: '≥',
  spades: '♠', clubs: '♣', hearts: '♥', diams: '♦', check: '✓', star: '★',
}

/** A code point that can appear in a well-formed string. */
function isScalar(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
}

/**
 * Decode named and numeric HTML references.
 *
 * A numeric reference whose value is not a valid code point (a surrogate, or
 * beyond U+10FFFF) is left as written instead of throwing — `String.fromCodePoint`
 * raises a RangeError for those, which used to take the whole tool down. The
 * trailing semicolon is optional for numeric references because browsers accept
 * both forms.
 */
export function decodeHtml(input: string): string {
  return input.replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const digits = body.slice(hex ? 2 : 1).replace(/;$/, '')
      const value = parseInt(digits, hex ? 16 : 10)
      return isScalar(value) ? String.fromCodePoint(value) : whole
    }
    return ENTITIES[body.slice(0, -1)] ?? whole
  })
}

/** Names for the handful of characters worth naming explicitly. */
const NAMES: Record<number, string> = {
  0x20: 'SPACE',
  0x09: 'CHARACTER TABULATION',
  0x0a: 'LINE FEED',
  0x0d: 'CARRIAGE RETURN',
  0x3c: 'LESS-THAN SIGN',
  0x3e: 'GREATER-THAN SIGN',
  0x26: 'AMPERSAND',
  0x22: 'QUOTATION MARK',
  0x27: 'APOSTROPHE',
  0xa0: 'NO-BREAK SPACE',
  0x200b: 'ZERO WIDTH SPACE',
  0x200d: 'ZERO WIDTH JOINER',
  0xfeff: 'ZERO WIDTH NO-BREAK SPACE',
  0xad: 'SOFT HYPHEN',
  0x200c: 'ZERO WIDTH NON-JOINER',
  0x2060: 'WORD JOINER',
  0x2420: 'SYMBOL FOR SPACE',
}

/**
 * General categories, most specific first. Testing with `\p{…}` and the `u`
 * flag gives the real category table for free instead of a hand-maintained
 * range list that would drift from Unicode.
 */
const CATEGORIES: [RegExp, string][] = [
  [/\p{Lu}/u, 'Uppercase letter (Lu)'],
  [/\p{Ll}/u, 'Lowercase letter (Ll)'],
  [/\p{Lt}/u, 'Titlecase letter (Lt)'],
  [/\p{Lm}/u, 'Modifier letter (Lm)'],
  [/\p{Lo}/u, 'Other letter (Lo)'],
  [/\p{Mn}/u, 'Nonspacing mark (Mn)'],
  [/\p{Mc}/u, 'Spacing mark (Mc)'],
  [/\p{Me}/u, 'Enclosing mark (Me)'],
  [/\p{Nd}/u, 'Decimal digit (Nd)'],
  [/\p{Nl}/u, 'Letter number (Nl)'],
  [/\p{No}/u, 'Other number (No)'],
  [/\p{Pc}/u, 'Connector punctuation (Pc)'],
  [/\p{Pd}/u, 'Dash punctuation (Pd)'],
  [/\p{Ps}/u, 'Open punctuation (Ps)'],
  [/\p{Pe}/u, 'Close punctuation (Pe)'],
  [/\p{Pi}/u, 'Initial quote (Pi)'],
  [/\p{Pf}/u, 'Final quote (Pf)'],
  [/\p{Po}/u, 'Other punctuation (Po)'],
  [/\p{Sm}/u, 'Math symbol (Sm)'],
  [/\p{Sc}/u, 'Currency symbol (Sc)'],
  [/\p{Sk}/u, 'Modifier symbol (Sk)'],
  [/\p{So}/u, 'Other symbol (So)'],
  [/\p{Zs}/u, 'Space separator (Zs)'],
  [/\p{Zl}/u, 'Line separator (Zl)'],
  [/\p{Zp}/u, 'Paragraph separator (Zp)'],
  [/\p{Cc}/u, 'Control (Cc)'],
  [/\p{Cf}/u, 'Format (Cf)'],
  [/\p{Co}/u, 'Private use (Co)'],
  [/\p{Cs}/u, 'Surrogate (Cs)'],
]

export function categoryOf(char: string): string {
  if (char.length === 1 && isLoneSurrogate(char.charCodeAt(0))) return 'Surrogate (Cs)'
  for (const [pattern, label] of CATEGORIES) {
    if (pattern.test(char)) return label
  }
  return 'Unassigned (Cn)'
}

/**
 * Characters that print nothing would leave the Char cell looking empty, which
 * reads as a bug. Each gets a visible stand-in instead: control pictures for
 * controls, a shouldered box for the two spaces that are not U+0020, a dotted
 * circle under a combining mark, and a boxed code point for the zero-width and
 * unpaired-surrogate characters that have no glyph at all.
 */
function displayOf(char: string, code: number): string {
  if (code === 0x20) return '␠'
  if (code === 0xa0) return '␣'
  if (code < 0x20) return String.fromCodePoint(0x2400 + code)
  if (code === 0x7f) return '␡'
  if (ZERO_WIDTH.has(code) || isLoneSurrogate(code)) return `⟨${hexOf(code)}⟩`
  if (/\p{Mn}|\p{Me}/u.test(char)) return `◌${char}`
  return char
}

/** Zero-width and invisible formatting characters with no glyph of their own. */
const ZERO_WIDTH = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])

/**
 * A code unit in D800–DFFF that is not part of a pair. It can only get into a
 * string by accident, and `TextEncoder` silently turns it into U+FFFD, so it is
 * worth flagging rather than reporting a byte count that is not the input's.
 */
export function isLoneSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff
}

function hexOf(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0')
}

/** Space-separated uppercase hex of the UTF-8 encoding. */
function utf8Hex(char: string): { hex: string; length: number } {
  const bytes = new TextEncoder().encode(char)
  return {
    hex: [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    length: bytes.length,
  }
}

export function inspect(input: string, limit = Number.POSITIVE_INFINITY): CharInfo[] {
  const infos: CharInfo[] = []
  let index = 0
  for (const char of input) {
    if (infos.length >= limit) break
    const codePoint = char.codePointAt(0) ?? 0
    const hex = codePoint.toString(16).toUpperCase()
    const utf8 = utf8Hex(char)
    infos.push({
      char,
      codePoint,
      index,
      hex,
      decimal: String(codePoint),
      unicode: `U+${hex.padStart(4, '0')}`,
      js: codePoint > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`,
      html: `&#${codePoint};`,
      utf8: utf8.hex,
      utf8Length: utf8.length,
      category: categoryOf(char),
      display: displayOf(char, codePoint),
      name: isLoneSurrogate(codePoint)
        ? 'LONE SURROGATE (not a character)'
        : NAMES[codePoint] ?? '',
    })
    index += char.length
  }
  return infos
}

export interface TextSummary {
  codePoints: number
  utf16Units: number
  utf8Bytes: number
  /** Grapheme clusters — what a reader would call a character. */
  graphemes: number
  ascii: number
  nonAscii: number
  /** Characters that occupy no visible space: controls, formats, separators. */
  unprintable: number
  /**
   * Unpaired UTF-16 surrogates. Non-zero means the text is not well-formed
   * Unicode and the UTF-8 byte count is an estimate: the encoder replaces each
   * one with U+FFFD (three bytes).
   */
  loneSurrogates: number
}

/**
 * Totals for the whole input. The counts differ in ways that matter — an emoji
 * is 1 code point, 2 UTF-16 units, 4 UTF-8 bytes and 1 grapheme — so each is
 * reported rather than collapsed into a single "characters" figure.
 */
export function summarise(input: string): TextSummary {
  let codePoints = 0
  let ascii = 0
  let unprintable = 0
  let loneSurrogates = 0
  for (const char of input) {
    codePoints++
    const code = char.codePointAt(0) ?? 0
    if (code < 128) ascii++
    if (char.length === 1 && isLoneSurrogate(char.charCodeAt(0))) loneSurrogates++
    if (code < 32 || code === 0x7f || (code >= 0x2000 && code <= 0x200f) || code === 0xfeff) unprintable++
  }
  return {
    codePoints,
    utf16Units: input.length,
    // One encoder call for the whole string; encoding per character is an order
    // of magnitude slower on a large paste for the same answer.
    utf8Bytes: new TextEncoder().encode(input).length,
    graphemes: countGraphemes(input),
    ascii,
    nonAscii: codePoints - ascii,
    unprintable,
    loneSurrogates,
  }
}

/** Grapheme count, falling back to code points where the API is absent. */
function countGraphemes(input: string): number {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment: (text: string) => Iterable<unknown> }
  }).Segmenter
  if (!Segmenter) return [...input].length
  try {
    let count = 0
    for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(input)) count++
    return count
  } catch {
    return [...input].length
  }
}

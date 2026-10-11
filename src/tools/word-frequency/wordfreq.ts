/**
 * Word and n-gram frequency counting.
 *
 * Tokenisation keeps letters, digits and internal apostrophes, so "don't"
 * stays one word. Case folding, stop-word removal, number removal and
 * stemming are optional because each one changes the answer you get.
 *
 * N-grams are built from *adjacent* tokens. Punctuation is what ends a phrase,
 * so "New York. New York" is two separate bigrams rather than one spanning the
 * sentence break, and a phrase never mixes a word with the stop word removed
 * from between it.
 */

export interface FrequencyOptions {
  caseSensitive?: boolean
  minLength?: number
  ignoreStopWords?: boolean
  /** Drop tokens that are only digits, so "2024" does not top the list. */
  ignoreNumbers?: boolean
  /** Fold simple plural and verb endings, so "cat" and "cats" count as one. */
  stem?: boolean
  ngramSize?: number
  /** Keep only the most frequent terms; 0 or undefined keeps every term. */
  top?: number
  /** Order the result by count (default) or alphabetically. */
  sort?: 'count' | 'alpha'
}

export interface Frequency {
  term: string
  count: number
  percent: number
}

export interface FrequencyReport {
  /** Tokens that survived every filter, including overlaps in n-grams. */
  totalWords: number
  /** Distinct terms in the result, before the `top` cut. */
  uniqueWords: number
  /** Total terms counted (identical to `uniqueWords` before the `top` cut). */
  totalTerms: number
  entries: Frequency[]
}

/** The most common English function words, used only when filtering is on. */
export const STOP_WORDS: string[] = [
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has',
  'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor',
  'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
]

const STOP = new Set(STOP_WORDS)

const HAS_LETTER = /\p{L}/u

/** One token plus whether a separator followed it, so n-grams stay adjacent. */
interface Token {
  text: string
  /** False when this token was the last of a sentence or clause. */
  continues: boolean
}

/** Split text into words, keeping internal apostrophes and hyphens. */
export function tokenizeWords(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
}

/**
 * Reduce a word to a rough base form: strip a possessive, then a plural or
 * verb ending. Deliberately simple — it is a toggle, not a linguistics engine,
 * so it only folds endings that are unambiguous in English.
 */
export function stemWord(word: string): string {
  const base = word.replace(/['’]s$/, '')
  if (base.length <= 3) return base
  if (base.endsWith('ies') && base.length > 4) return `${base.slice(0, -3)}y`
  if (base.endsWith('sses')) return base.slice(0, -2)
  if (/(?:[sxz]|ch|sh)es$/.test(base)) return base.slice(0, -2)
  if (base.endsWith('ss')) return base
  if (base.endsWith('s') && !base.endsWith('us') && !base.endsWith('is')) return base.slice(0, -1)
  if (base.endsWith('ing') && base.length > 5) return undouble(base.slice(0, -3))
  if (base.endsWith('ed') && base.length > 4) return undouble(base.slice(0, -2))
  return base
}

/**
 * Drop one of a trailing doubled consonant, so "running" and "hopped" fold to
 * "run" and "hop" instead of "runn" and "hopp". The letters that double
 * meaningfully in English (l, s, z) are left alone, as is a stem of only three
 * letters, so "adding" never collapses to "ad".
 */
function undouble(base: string): string {
  const last = base.at(-1)
  if (!last || last !== base.at(-2) || 'lsz'.includes(last)) return base
  return base.length > 3 ? base.slice(0, -1) : base
}

function buildTokens(text: string, options: FrequencyOptions): Token[] {
  const minLength = Math.max(1, Math.floor(options.minLength ?? 1))
  const fold = !options.caseSensitive
  const dropStop = options.ignoreStopWords ?? false
  const dropNumbers = options.ignoreNumbers ?? false
  const useStem = options.stem ?? false

  const matches = text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
  const tokens: Token[] = []
  let last = 0
  // Set when a token was dropped, so the two words around the gap do not
  // become an n-gram: "statue of liberty" has no bigram "statue liberty".
  let broken = false

  for (const match of matches) {
    const start = match.index ?? 0
    // Everything between the previous token and this one is whitespace and
    // punctuation. A phrase continues across a plain space (and across the
    // quotes in "rock 'n' roll") but breaks at a newline or any other mark, so
    // "end. next" never yields the phrase "end next".
    const gap = text.slice(last, start)
    const separated = /[\n\r]/.test(gap) || gap.replace(/[\s'’‘"“”]+/g, '') !== ''
    if (tokens.length > 0) tokens[tokens.length - 1].continues = !(separated || broken)
    broken = false

    let word = fold ? match[0].toLowerCase() : match[0]
    const drop = () => {
      if (tokens.length > 0) tokens[tokens.length - 1].continues = false
      broken = true
    }
    if (dropNumbers && !HAS_LETTER.test(word)) drop()
    else {
      if (useStem) word = stemWord(word)
      if (word.length < minLength) drop()
      else if (dropStop && STOP.has(word)) drop()
      else tokens.push({ text: word, continues: true })
    }
    last = start + match[0].length
  }

  return tokens
}

export function frequency(text: string, options: FrequencyOptions = {}): FrequencyReport {
  const size = Math.max(1, Math.min(5, Math.floor(options.ngramSize ?? 1)))
  const tokens = buildTokens(text, options)

  const counts = new Map<string, number>()
  let total = 0
  let run: string[] = []
  const flush = () => {
    for (let i = 0; i + size <= run.length; i++) {
      const term = run.slice(i, i + size).join(' ')
      counts.set(term, (counts.get(term) ?? 0) + 1)
      total += 1
    }
  }
  for (const token of tokens) {
    run.push(token.text)
    if (!token.continues) {
      flush()
      run = []
    }
  }
  flush()

  const entries = [...counts.entries()]
    .map(([term, count]) => ({ term, count, percent: total ? (count / total) * 100 : 0 }))
    .sort((a, b) =>
      options.sort === 'alpha' ? a.term.localeCompare(b.term) : b.count - a.count || a.term.localeCompare(b.term),
    )

  return {
    totalWords: tokens.length,
    uniqueWords: entries.length,
    totalTerms: total,
    entries: options.top && options.top > 0 ? entries.slice(0, Math.floor(options.top)) : entries,
  }
}

/** The distinct terms and their counts, most frequent first. */
export function topTerms(text: string, options: FrequencyOptions = {}): string[] {
  return frequency(text, options).entries.map((entry) => entry.term)
}

/**
 * Read an integer from a text field, clamping it to [min, max]. Empty input
 * falls back silently; anything that is not a finite number, or a value the
 * clamp had to change, is flagged so the caller can say what it did.
 */
export function parseIntField(
  raw: string,
  fallback: number,
  min: number,
  max: number,
): { value: number; invalid: boolean } {
  const text = raw.trim()
  if (text === '') return { value: fallback, invalid: false }
  const number = Number(text)
  if (!Number.isFinite(number)) return { value: fallback, invalid: true }
  const value = Math.min(max, Math.max(min, Math.floor(number)))
  return { value, invalid: value !== number }
}

/** Longest word, useful as a sanity check on tokenisation. */
export function longestWord(text: string): string {
  return tokenizeWords(text).reduce((longest, word) => (word.length > longest.length ? word : longest), '')
}

/** The result as tab-separated values, one term per line. */
export function toTsv(entries: Frequency[], precision = 2): string {
  return entries.map((entry) => `${entry.term}\t${entry.count}\t${entry.percent.toFixed(precision)}%`).join('\n')
}

/** The result as CSV, ready to paste into a spreadsheet. */
export function toCsv(entries: Frequency[]): string {
  const cell = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  const rows = entries.map((entry) => `${cell(entry.term)},${entry.count},${entry.percent.toFixed(4)}`)
  return ['term,count,percent', ...rows].join('\n')
}

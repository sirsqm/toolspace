/**
 * Line and word diffing via longest-common-subsequence.
 *
 * The module keeps every judgement it makes here rather than in the DOM layer:
 * what counts as "the same line" (exact, case- or whitespace-insensitive), how
 * a changed line is broken into inline word runs, how unchanged stretches are
 * folded down to context, and how many lines each side contributed. The viewer
 * only paints what these functions return.
 */

export type DiffType = 'equal' | 'add' | 'remove'

export interface DiffPart {
  type: DiffType
  value: string
}

/** A word-level run inside a paired remove/add line. */
export interface InlineRun {
  type: DiffType
  value: string
}

export interface DiffGroup<T> {
  type: DiffType
  items: T[]
}

export interface DiffOptions {
  /** Ignore letter case when deciding whether two lines match. */
  ignoreCase?: boolean
  /** Treat runs of whitespace as one space, and trim ends, before matching. */
  ignoreWhitespace?: boolean
}

/**
 * Build the key a line is compared by. Two lines are "the same" when their
 * keys are equal, so an option only has to change this one function.
 */
function keyOf(line: string, options: DiffOptions): string {
  let key = line
  if (options.ignoreWhitespace) key = key.replace(/\s+/g, ' ').trim()
  if (options.ignoreCase) key = key.toLowerCase()
  return key
}

/**
 * Classic LCS table diff. Falls back to a coarse replace when inputs are very
 * large, so the O(n·m) table cannot freeze the tab.
 */
export function diff<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): DiffGroup<T>[] {
  const MAX = 4000
  if (a.length > MAX || b.length > MAX) return coarse(a, b, equals)

  const n = a.length
  const m = b.length
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = equals(a[i], b[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const groups: DiffGroup<T>[] = []
  const push = (type: DiffType, item: T) => {
    const last = groups[groups.length - 1]
    if (last && last.type === type) last.items.push(item)
    else groups.push({ type, items: [item] })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (equals(a[i], b[j])) {
      push('equal', a[i])
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push('remove', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) push('remove', a[i++])
  while (j < m) push('add', b[j++])
  return groups
}

function coarse<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): DiffGroup<T>[] {
  const tail = suffix(a, b, equals)
  let prefix = 0
  while (prefix < a.length - tail && prefix < b.length - tail && equals(a[prefix], b[prefix])) prefix++

  const groups: DiffGroup<T>[] = []
  if (prefix) groups.push({ type: 'equal', items: a.slice(0, prefix) })
  const midA = a.slice(prefix, a.length - tail)
  const midB = b.slice(prefix, b.length - tail)
  if (midA.length) groups.push({ type: 'remove', items: midA })
  if (midB.length) groups.push({ type: 'add', items: midB })
  if (tail) groups.push({ type: 'equal', items: a.slice(a.length - tail) })
  return groups
}

function suffix<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): number {
  let count = 0
  while (
    count < a.length &&
    count < b.length &&
    equals(a[a.length - 1 - count], b[b.length - 1 - count])
  ) count++
  return count
}

function toParts<T>(groups: DiffGroup<T>[], join: (items: T[]) => string): DiffPart[] {
  return groups.map((group) => ({ type: group.type, value: join(group.items) }))
}

/** Split text into lines, treating CRLF, CR and LF alike. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n?|\n/)
}

/** How many lines a block of text contains. An empty string is one empty line. */
export function lineCount(text: string): number {
  return splitLines(text).length
}

export function diffLines(before: string, after: string, options: DiffOptions = {}): DiffPart[] {
  const equals = (x: string, y: string) => keyOf(x, options) === keyOf(y, options)
  const groups = diff(splitLines(before), splitLines(after), equals)
  return toParts(groups, (items) => items.join('\n'))
}

export function diffWords(before: string, after: string): DiffPart[] {
  const groups = diff(tokenize(before), tokenize(after), (x, y) => x === y)
  return toParts(groups, (items) => items.join(''))
}

/** Split into words and the whitespace between them, keeping exact spacing. */
export function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? []
}

export interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

export function diffStats(parts: DiffPart[]): DiffStats {
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 }
  for (const part of parts) {
    if (!part.value) continue
    const count = part.value.split('\n').length
    if (part.type === 'add') stats.added += count
    else if (part.type === 'remove') stats.removed += count
    else stats.unchanged += count
  }
  return stats
}

/* -------------------------------------------------------------------------
   Aligned rows
   ------------------------------------------------------------------------- */

export interface DiffRow {
  type: DiffType
  /** 1-based line number on the before side, or null when the line is an add. */
  leftNumber: number | null
  /** 1-based line number on the after side, or null when the line is a remove. */
  rightNumber: number | null
  left: string
  right: string
  /** Word runs for the line pair; empty for equal rows. */
  inline: InlineRun[]
}

/**
 * Turn the grouped diff into one row per line, pairing each run of removals
 * with the run of additions that follows it so the two sides line up. A paired
 * row also gets its word-level runs, which is what lets the viewer highlight
 * *what* changed inside a line instead of tinting the whole thing.
 */
export function diffRows(before: string, after: string, options: DiffOptions = {}): DiffRow[] {
  const equals = (x: string, y: string) => keyOf(x, options) === keyOf(y, options)
  const groups = diff(splitLines(before), splitLines(after), equals)
  const rows: DiffRow[] = []
  let left = 1
  let right = 1

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]
    if (group.type === 'equal') {
      for (const line of group.items) {
        rows.push({ type: 'equal', leftNumber: left++, rightNumber: right++, left: line, right: line, inline: [] })
      }
      continue
    }

    if (group.type === 'remove') {
      const next = groups[g + 1]
      const adds = next && next.type === 'add' ? next.items : []
      if (next && next.type === 'add') g++
      const count = Math.max(group.items.length, adds.length)
      for (let k = 0; k < count; k++) {
        const leftLine = k < group.items.length ? group.items[k] : null
        const rightLine = k < adds.length ? adds[k] : null
        const type: DiffType = leftLine == null ? 'add' : rightLine == null ? 'remove' : 'add'
        rows.push({
          type,
          leftNumber: leftLine == null ? null : left++,
          rightNumber: rightLine == null ? null : right++,
          left: leftLine ?? '',
          right: rightLine ?? '',
          inline: leftLine != null && rightLine != null ? inlineRuns(leftLine, rightLine) : [],
        })
      }
      continue
    }

    // A lone add group (no preceding removal to pair with).
    for (const line of group.items) {
      rows.push({ type: 'add', leftNumber: null, rightNumber: right++, left: '', right: line, inline: [] })
    }
  }

  return rows
}

/**
 * Word-level runs for a line pair, as one interleaved list. Equal runs appear
 * once and are shown on both sides so the two lines stay in step.
 */
export function inlineRuns(left: string, right: string): InlineRun[] {
  const groups = diff(tokenize(left), tokenize(right), (x, y) => x === y)
  return groups.map((group) => ({ type: group.type, value: group.items.join('') }))
}

/** Split inline runs into the two sides for rendering, keeping them aligned. */
export function inlineSides(runs: InlineRun[]): { left: InlineRun[]; right: InlineRun[] } {
  const leftRuns: InlineRun[] = []
  const rightRuns: InlineRun[] = []
  for (const run of runs) {
    if (run.type !== 'add') leftRuns.push(run)
    if (run.type !== 'remove') rightRuns.push(run)
  }
  return { left: leftRuns, right: rightRuns }
}

/* -------------------------------------------------------------------------
   Folding
   ------------------------------------------------------------------------- */

export type FoldedRow = DiffRow | { folded: number }

/**
 * Collapse long stretches of unchanged lines down to `context` lines on each
 * side of a change. Without this a one-word edit in a 2000-line file is buried
 * under 1999 lines of noise.
 */
export function foldRows(rows: DiffRow[], context = 3): FoldedRow[] {
  // With no changes there is nothing to keep context around, and folding the
  // whole file behind a "show all" button would hide an identical match.
  if (rows.every((row) => row.type === 'equal')) return rows

  const keep = new Array<boolean>(rows.length).fill(false)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type !== 'equal') {
      for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true
    }
  }

  const out: FoldedRow[] = []
  let hidden = 0
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) {
      if (hidden) {
        out.push({ folded: hidden })
        hidden = 0
      }
      out.push(rows[i])
    } else {
      hidden++
    }
  }
  if (hidden) out.push({ folded: hidden })
  return out
}

/** How many lines each side contributed, so a line count can be shown. */
export function sideCounts(before: string, after: string): { before: number; after: number } {
  return { before: lineCount(before), after: lineCount(after) }
}

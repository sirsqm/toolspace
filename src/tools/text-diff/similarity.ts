/**
 * String similarity.
 *
 * Levenshtein gives the edit distance; the ratio normalises it to 0–1 so two
 * pairs of different lengths can be compared. The two-row implementation keeps
 * memory at O(min(n, m)) instead of a full table.
 */

/** Edit distance: the fewest insertions, deletions or substitutions to go from a to b. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  // Compare code points so emoji and accents count as one edit, not two.
  const left = [...a]
  const right = [...b]
  if (left.length > right.length) return levenshtein(b, a)

  let previous = Array.from({ length: left.length + 1 }, (_, i) => i)
  for (let j = 1; j <= right.length; j++) {
    const current = [j]
    for (let i = 1; i <= left.length; i++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[i] = Math.min(previous[i] + 1, current[i - 1] + 1, previous[i - 1] + cost)
    }
    previous = current
  }
  return previous[left.length]
}

/** Similarity from 0 (nothing alike) to 1 (identical). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  const longest = Math.max([...a].length, [...b].length)
  if (longest === 0) return 1
  return 1 - levenshtein(a, b) / longest
}

/** Similarity shown as a whole-number percentage. */
export function similarityPercent(a: string, b: string): number {
  return Math.round(similarity(a, b) * 100)
}

/**
 * Largest Levenshtein table we will fill in one go, in cells. The two-row
 * algorithm is O(n·m) in time, so two pasted 100k-character documents would be
 * ~10^10 steps — minutes of a frozen tab. Above this budget we compare a
 * bounded prefix of each side and say so, rather than hanging.
 */
const MAX_CELLS = 9_000_000

export interface SimilarityResult {
  percent: number
  distance: number
  /** False when the whole input was compared; true when only a prefix was. */
  approximate: boolean
  /** How many characters of each side were actually compared. */
  compared: number
}

/** Whole-document similarity, bounded so a huge paste cannot freeze the tab. */
export function compareText(a: string, b: string): SimilarityResult {
  const shortest = Math.min([...a].length, [...b].length)
  const longest = Math.max([...a].length, [...b].length)
  if (longest === 0) return { percent: 100, distance: 0, approximate: false, compared: 0 }

  if (longest * shortest <= MAX_CELLS) {
    return {
      percent: similarityPercent(a, b),
      distance: levenshtein(a, b),
      approximate: false,
      compared: longest,
    }
  }

  // Trim both sides to a prefix whose comparison fits the budget, keeping the
  // cost fixed regardless of how much was pasted.
  const cap = Math.max(1, Math.floor(Math.sqrt(MAX_CELLS)))
  const leftPrefix = [...a].slice(0, cap).join('')
  const rightPrefix = [...b].slice(0, cap).join('')
  return {
    percent: similarityPercent(leftPrefix, rightPrefix),
    distance: levenshtein(leftPrefix, rightPrefix),
    approximate: true,
    compared: cap,
  }
}

export interface SimilarityRow {
  a: string
  b: string
  distance: number
  percent: number
}

/** Above this many line pairs, only the first slice of each side is compared. */
const MAX_PAIRS = 250_000
const MAX_PAIR_LINES = 500

/** Compare every line of one text against every line of another, best first. */
export function closestPairs(before: string, after: string, limit = 20): SimilarityRow[] {
  const left = before.split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean)
  const right = after.split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean)

  // Every pair costs a Levenshtein run, so a pair of long files would be
  // quadratic on top of quadratic. Past the cap, compare the first slice of
  // each side only — enough to surface the interesting matches, and it keeps
  // the panel instant on the largest sensible paste.
  if (left.length * right.length > MAX_PAIRS) {
    left.length = Math.min(left.length, MAX_PAIR_LINES)
    right.length = Math.min(right.length, MAX_PAIR_LINES)
  }

  const rows: SimilarityRow[] = []
  for (const a of left) {
    for (const b of right) {
      if (a === b) continue
      rows.push({ a, b, distance: levenshtein(a, b), percent: similarityPercent(a, b) })
    }
  }
  return rows.sort((x, y) => y.percent - x.percent || x.distance - y.distance).slice(0, limit)
}

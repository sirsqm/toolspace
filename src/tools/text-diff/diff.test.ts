import { describe, expect, it } from 'vitest'
import {
  diff,
  diffLines,
  diffRows,
  diffStats,
  diffWords,
  foldRows,
  inlineRuns,
  inlineSides,
  lineCount,
  sideCounts,
  splitLines,
  tokenize,
} from './diff'

describe('splitLines', () => {
  it('treats CRLF, CR and LF alike', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps a trailing empty line', () => {
    expect(splitLines('a\n')).toEqual(['a', ''])
  })

  it('counts an empty string as one line', () => {
    expect(lineCount('')).toBe(1)
    expect(lineCount('a\nb')).toBe(2)
  })
})

describe('diffLines', () => {
  it('marks unchanged, added and removed lines', () => {
    const parts = diffLines('a\nb\nc', 'a\nx\nc')
    expect(parts.map((p) => p.type)).toEqual(['equal', 'remove', 'add', 'equal'])
  })

  it('handles pure additions', () => {
    expect(diffLines('a', 'a\nb')).toEqual([
      { type: 'equal', value: 'a' },
      { type: 'add', value: 'b' },
    ])
  })

  it('handles empty sides', () => {
    expect(diffLines('', 'a').some((p) => p.type === 'add')).toBe(true)
    expect(diffLines('a', '').some((p) => p.type === 'remove')).toBe(true)
  })

  it('ignores case when asked', () => {
    const strict = diffLines('Foo', 'foo')
    expect(strict.map((p) => p.type)).toEqual(['remove', 'add'])
    const loose = diffLines('Foo', 'foo', { ignoreCase: true })
    expect(loose.map((p) => p.type)).toEqual(['equal'])
  })

  it('ignores whitespace when asked', () => {
    const strict = diffLines('a  b', 'a b')
    expect(strict.map((p) => p.type)).toEqual(['remove', 'add'])
    const loose = diffLines('a  b', 'a b', { ignoreWhitespace: true })
    expect(loose.map((p) => p.type)).toEqual(['equal'])
  })

  it('keeps the original text when matching loosely', () => {
    const loose = diffLines('Foo', 'foo', { ignoreCase: true })
    expect(loose[0].value).toBe('Foo')
  })
})

describe('diff (generic)', () => {
  it('produces an LCS edit script', () => {
    const groups = diff([1, 2, 3], [1, 3, 4], (a, b) => a === b)
    expect(groups.map((g) => g.type)).toEqual(['equal', 'remove', 'equal', 'add'])
    expect(groups[3].items).toEqual([4])
  })

  it('handles both-empty input', () => {
    expect(diff([], [], (a, b) => a === b)).toEqual([])
  })

  it('stays exact for a one-line change in a large file (trim beats the cap)', () => {
    const a = Array.from({ length: 4100 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 4100 }, (_, i) => `a${i}`)
    b[2050] = 'changed'
    const groups = diff(a, b, (x, y) => x === y)
    const removed = groups.filter((g) => g.type === 'remove').flatMap((g) => g.items)
    const added = groups.filter((g) => g.type === 'add').flatMap((g) => g.items)
    expect(removed).toEqual(['a2050'])
    expect(added).toEqual(['changed'])
  })

  it('falls back to a coarse diff when a huge middle has no common edges', () => {
    const a = Array.from({ length: 5000 }, (_, i) => `a${i}`)
    const b = Array.from({ length: 5000 }, (_, i) => `b${i}`)
    const groups = diff(a, b, (x, y) => x === y)
    expect(groups.map((g) => g.type)).toEqual(['remove', 'add'])
    expect(groups[0].items).toEqual(a)
    expect(groups[1].items).toEqual(b)
  })

  it('trims a shared prefix and suffix into single equal groups', () => {
    const groups = diff(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'X', 'd', 'e'], (x, y) => x === y)
    expect(groups.map((g) => g.type)).toEqual(['equal', 'remove', 'add', 'equal'])
    expect(groups[0].items).toEqual(['a', 'b'])
    expect(groups[3].items).toEqual(['d', 'e'])
  })

  it('coalesces trims that meet the middle diff', () => {
    // Every element matches, so the trims cover the whole input and the middle
    // is empty: the result must be a single equal group, not three.
    const groups = diff(['a', 'b', 'c'], ['a', 'b', 'c'], (x, y) => x === y)
    expect(groups).toEqual([{ type: 'equal', items: ['a', 'b', 'c'] }])
  })

  it('diffs a huge file exactly when only one line changed', () => {
    // 50k identical lines with a single edit: the trim leaves a tiny middle, so
    // this stays an exact LCS diff rather than the coarse fallback.
    const a = Array.from({ length: 50000 }, (_, i) => `line ${i}`)
    const b = a.slice()
    b[25000] = 'line 25000 changed'
    const groups = diff(a, b, (x, y) => x === y)
    expect(groups.map((g) => g.type)).toEqual(['equal', 'remove', 'add', 'equal'])
    expect(groups[0].items.length).toBe(25000)
    expect(groups[3].items.length).toBe(24999)
  })

  it('does not trim overlapping prefix and suffix runs', () => {
    const groups = diff(['a', 'a', 'a'], ['a'], (x, y) => x === y)
    const removed = groups.filter((g) => g.type === 'remove').flatMap((g) => g.items)
    const equal = groups.filter((g) => g.type === 'equal').flatMap((g) => g.items)
    expect(equal).toEqual(['a'])
    expect(removed).toEqual(['a', 'a'])
  })
})

describe('diffWords', () => {
  it('finds changed words with exact spacing', () => {
    const parts = diffWords('the quick fox', 'the slow fox')
    const removed = parts.filter((p) => p.type === 'remove').map((p) => p.value).join('')
    const added = parts.filter((p) => p.type === 'add').map((p) => p.value).join('')
    expect(removed).toContain('quick')
    expect(added).toContain('slow')
  })

  it('round-trips the concatenation of each side', () => {
    const parts = diffWords('a b  c', 'a  c d')
    const before = parts.filter((p) => p.type !== 'add').map((p) => p.value).join('')
    const after = parts.filter((p) => p.type !== 'remove').map((p) => p.value).join('')
    expect(before).toBe('a b  c')
    expect(after).toBe('a  c d')
  })
})

describe('tokenize', () => {
  it('keeps whitespace', () => {
    expect(tokenize('a  b')).toEqual(['a', '  ', 'b'])
  })

  it('returns nothing for empty input', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('diffStats', () => {
  it('counts changes', () => {
    const stats = diffStats(diffLines('a\nb', 'a\nc'))
    expect(stats.removed).toBe(1)
    expect(stats.added).toBe(1)
    expect(stats.unchanged).toBeGreaterThanOrEqual(1)
  })

  it('does not count an empty tail as a line', () => {
    expect(diffStats([{ type: 'equal', value: '' }])).toEqual({ added: 0, removed: 0, unchanged: 0 })
  })
})

describe('diffRows', () => {
  it('numbers each side and pairs changed lines', () => {
    const rows = diffRows('a\nb\nc', 'a\nx\nc')
    expect(rows.map((r) => r.type)).toEqual(['equal', 'add', 'equal'])
    expect(rows[0]).toMatchObject({ leftNumber: 1, rightNumber: 1 })
    expect(rows[1]).toMatchObject({ leftNumber: 2, rightNumber: 2, left: 'b', right: 'x' })
    expect(rows[2]).toMatchObject({ leftNumber: 3, rightNumber: 3 })
  })

  it('gives a lone removal a null right number and a lone addition a null left number', () => {
    const removed = diffRows('a\nb', 'a')
    expect(removed[1]).toMatchObject({ type: 'remove', leftNumber: 2, rightNumber: null })
    const added = diffRows('a', 'a\nb')
    expect(added[1]).toMatchObject({ type: 'add', leftNumber: null, rightNumber: 2 })
  })

  it('pads the shorter side of an uneven change', () => {
    const rows = diffRows('a\nb\nc\nd', 'a\nx\nd')
    // b,c removed and x added: three rows, the last with a blank left side.
    expect(rows).toHaveLength(4)
    expect(rows[1].left).toBe('b')
    expect(rows[1].right).toBe('x')
    expect(rows[2].left).toBe('c')
    expect(rows[2].right).toBe('')
    expect(rows[2].rightNumber).toBeNull()
  })

  it('adds inline word runs to a paired line', () => {
    const rows = diffRows('the quick fox', 'the slow fox')
    const changed = rows.find((r) => r.inline.length)
    expect(changed).toBeTruthy()
    const sides = inlineSides(changed!.inline)
    expect(sides.left.map((r) => r.value).join('')).toBe('the quick fox')
    expect(sides.right.map((r) => r.value).join('')).toBe('the slow fox')
  })

  it('leaves equal rows without inline runs', () => {
    const rows = diffRows('same', 'same')
    expect(rows[0].inline).toEqual([])
  })

  it('produces one row per line for identical input', () => {
    const rows = diffRows('a\nb\nc', 'a\nb\nc')
    expect(rows.every((r) => r.type === 'equal')).toBe(true)
    expect(rows).toHaveLength(3)
  })
})

describe('inlineRuns', () => {
  it('keeps the two sides in step so equal text is shared', () => {
    const runs = inlineRuns('a b c', 'a x c')
    const sides = inlineSides(runs)
    expect(sides.left.map((r) => r.type)).toContain('remove')
    expect(sides.right.map((r) => r.type)).toContain('add')
  })

  it('marks nothing changed for identical lines', () => {
    const runs = inlineRuns('identical', 'identical')
    expect(runs.every((r) => r.type === 'equal')).toBe(true)
  })
})

describe('foldRows', () => {
  it('folds long unchanged stretches to context lines', () => {
    const rows = diffRows(
      Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'),
      Array.from({ length: 20 }, (_, i) => (i === 10 ? 'changed' : `l${i}`)).join('\n'),
    )
    const folded = foldRows(rows, 3)
    const hidden = folded.reduce((sum, row) => sum + ('folded' in row ? row.folded : 0), 0)
    expect(hidden).toBeGreaterThan(0)
    // 3 context lines each side of the single change are kept.
    expect(folded.filter((row) => !('folded' in row))).toHaveLength(7)
  })

  it('leaves short inputs untouched', () => {
    const rows = diffRows('a\nb', 'a\nc')
    expect(foldRows(rows, 3)).toEqual(rows)
  })

  it('does not fold a file that is identical throughout', () => {
    const rows = diffRows('a\nb', 'a\nb')
    const folded = foldRows(rows, 3)
    expect(folded).toEqual(rows)
  })
})

describe('sideCounts', () => {
  it('reports the line count of each side', () => {
    expect(sideCounts('a\nb', 'a\nb\nc')).toEqual({ before: 2, after: 3 })
  })
})

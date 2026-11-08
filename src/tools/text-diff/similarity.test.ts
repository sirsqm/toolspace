import { describe, expect, it } from 'vitest'
import { closestPairs, compareText, levenshtein, similarity, similarityPercent } from './similarity'

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0)
  })

  it('counts insertions, deletions and substitutions', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('abc', '')).toBe(3)
    expect(levenshtein('cat', 'cut')).toBe(1)
  })

  it('is symmetric', () => {
    expect(levenshtein('flaw', 'lawn')).toBe(levenshtein('lawn', 'flaw'))
  })

  it('counts an emoji as a single character', () => {
    expect(levenshtein('a😀b', 'a😀c')).toBe(1)
  })
})

describe('similarity', () => {
  it('is 1 for identical and 0 for disjoint', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('', '')).toBe(1)
    expect(similarity('abc', 'xyz')).toBe(0)
  })

  it('lands between 0 and 1', () => {
    expect(similarityPercent('kitten', 'sitting')).toBe(57)
    expect(similarityPercent('color', 'colour')).toBe(83)
  })
})

describe('compareText', () => {
  it('matches similarity and distance when the input fits the budget', () => {
    const result = compareText('kitten', 'sitting')
    expect(result.approximate).toBe(false)
    expect(result.distance).toBe(levenshtein('kitten', 'sitting'))
    expect(result.percent).toBe(similarityPercent('kitten', 'sitting'))
  })

  it('is exact for two empty strings', () => {
    expect(compareText('', '')).toEqual({ percent: 100, distance: 0, approximate: false, compared: 0 })
  })

  it('bounds the work and flags it as approximate on a huge pair', () => {
    const a = 'x'.repeat(20000)
    const b = 'y'.repeat(20000)
    const start = performance.now()
    const result = compareText(a, b)
    expect(performance.now() - start).toBeLessThan(4000)
    expect(result.approximate).toBe(true)
    expect(result.compared).toBeLessThan(20000)
  })
})

describe('closestPairs', () => {
  it('ranks the most similar line pairs first and skips exact matches', () => {
    const rows = closestPairs('colour\nhello', 'color\nworld')
    expect(rows[0].b).toBe('color')
    expect(rows[0].a).toBe('colour')
    expect(rows.some((row) => row.a === 'hello' && row.b === 'world')).toBe(true)
  })

  it('never returns an exact match', () => {
    const rows = closestPairs('same\none', 'same\ntwo')
    expect(rows.every((row) => row.a !== row.b)).toBe(true)
  })

  it('respects the limit', () => {
    const rows = closestPairs('a\nb\nc', 'x\ny\nz', 2)
    expect(rows).toHaveLength(2)
  })

  it('stays fast on two long files (pair count is capped)', () => {
    const before = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n')
    const after = Array.from({ length: 4000 }, (_, i) => `line ${i} edited`).join('\n')
    const start = performance.now()
    const rows = closestPairs(before, after)
    expect(performance.now() - start).toBeLessThan(4000)
    expect(rows.length).toBeLessThanOrEqual(20)
  })
})

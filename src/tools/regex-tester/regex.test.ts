import { describe, expect, it } from 'vitest'
import { compile, explain, highlight, runRegex } from './regex'

describe('runRegex', () => {
  it('finds all global matches with indices', () => {
    const { matches } = runRegex('\\d+', 'g', 'a1 b22 c333')
    expect(matches.map((m) => m.value)).toEqual(['1', '22', '333'])
    expect(matches[1].index).toBe(4)
  })

  it('reports capture groups and named groups', () => {
    const { matches } = runRegex('(?<year>\\d{4})-(\\d{2})', '', '2024-05')
    expect(matches[0].groups).toEqual(['2024', '05'])
    expect(matches[0].named.year).toBe('2024')
  })

  it('does not loop forever on zero-width matches', () => {
    const { matches } = runRegex('a*', 'g', 'bb')
    expect(matches.length).toBeLessThan(10)
  })

  it('returns an error for invalid patterns', () => {
    expect(runRegex('(', 'g', 'x').error).toBeTruthy()
  })

  it('reports a truncated match list when the limit is hit', () => {
    const { matches, truncated } = runRegex('a', 'g', 'aaaaa', 3)
    expect(matches).toHaveLength(3)
    expect(truncated).toBe(true)
  })

  it('does not flag truncation when everything fits', () => {
    const { truncated } = runRegex('a', 'g', 'aa', 10)
    expect(truncated).toBe(false)
  })

  it('honours the sticky flag', () => {
    // With `y`, a match must start exactly at lastIndex (0 here), so only the
    // leading run matches.
    const { matches } = runRegex('a', 'gy', 'aaab')
    expect(matches.map((m) => m.index)).toEqual([0, 1, 2])
  })

  it('finds a single match when the g flag is absent', () => {
    const { matches } = runRegex('\\d', '', 'a1b2c3')
    expect(matches).toHaveLength(1)
    expect(matches[0].value).toBe('1')
  })

  it('keeps zero-width matches in the list', () => {
    const { matches } = runRegex('(?=a)', 'g', 'aa')
    expect(matches.map((m) => m.index)).toEqual([0, 1])
    expect(matches.every((m) => m.value === '')).toBe(true)
  })
})

describe('compile', () => {
  it('does not duplicate the d flag', () => {
    const { regex } = compile('a', 'dgi')
    expect(regex?.flags.split('').filter((f) => f === 'd')).toHaveLength(1)
  })
})

describe('explain', () => {
  it('describes common constructs', () => {
    const tokens = explain('^\\d{3}[a-z]+$')
    const meanings = tokens.map((t) => t.meaning).join(' | ')
    expect(meanings).toContain('start of the string')
    expect(meanings).toContain('a digit')
    expect(meanings).toContain('exactly 3 times')
    expect(meanings).toContain('one of a-z')
    expect(meanings).toContain('one or more')
    expect(meanings).toContain('end of the string')
  })

  it('describes named groups', () => {
    const tokens = explain('(?<id>\\d+)')
    expect(tokens.some((t) => t.meaning.includes('named group “id”'))).toBe(true)
  })

  it('distinguishes capturing, non-capturing and lookaround groups', () => {
    expect(explain('(a)')[0].meaning).toContain('capturing group')
    expect(explain('(?:a)')[0].meaning).toContain('non-capturing group')
    expect(explain('(?=a)')[0].meaning).toContain('positive lookahead')
    expect(explain('(?!a)')[0].meaning).toContain('negative lookahead')
    expect(explain('(?<=a)')[0].meaning).toContain('positive lookbehind')
    expect(explain('(?<!a)')[0].meaning).toContain('negative lookbehind')
  })

  it('does not mistake a lookbehind for a named group', () => {
    const tokens = explain('(?<=x)')
    expect(tokens.some((t) => t.meaning.includes('named group'))).toBe(false)
  })

  it('handles a closing bracket escaped inside a character class', () => {
    const tokens = explain('[\\]]')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].token).toBe('[\\]]')
    expect(tokens[0].meaning).toBe('one of \\]')
  })

  it('marks a negated character class', () => {
    expect(explain('[^a-z]')[0].meaning).toContain('not a-z')
  })

  it('describes backreferences', () => {
    const tokens = explain('(a)\\1')
    expect(tokens.some((t) => t.meaning.includes('group 1'))).toBe(true)
  })

  it('describes named backreferences', () => {
    const tokens = explain('(?<w>a)\\k<w>')
    expect(tokens.some((t) => t.meaning.includes('named group “w”'))).toBe(true)
  })

  it('describes code-point escapes', () => {
    expect(explain('\\x41').some((t) => t.meaning.includes('U+0041'))).toBe(true)
    expect(explain('\\u0041').some((t) => t.meaning.includes('U+0041'))).toBe(true)
    expect(explain('\\u{1F600}').some((t) => t.meaning.includes('U+1F600'))).toBe(true)
  })

  it('describes unicode property escapes', () => {
    expect(explain('\\p{L}')[0].meaning).toContain('Unicode property L')
    expect(explain('\\P{L}')[0].meaning).toContain('not a character')
  })

  it('describes a range repeat', () => {
    const tokens = explain('a{2,4}')
    expect(tokens.some((t) => t.meaning.includes('between 2 and 4'))).toBe(true)
  })

  it('returns nothing for an empty pattern', () => {
    expect(explain('')).toEqual([])
  })
})

describe('highlight', () => {
  it('splits text into matched and unmatched runs', () => {
    const { matches } = runRegex('\\d+', 'g', 'a1b22')
    const parts = highlight('a1b22', matches)
    expect(parts).toEqual([
      { text: 'a', match: false },
      { text: '1', match: true },
      { text: 'b', match: false },
      { text: '22', match: true },
    ])
  })

  it('drops zero-width matches from the painted runs', () => {
    const { matches } = runRegex('(?=b)', 'g', 'ab')
    const parts = highlight('ab', matches)
    expect(parts).toEqual([{ text: 'ab', match: false }])
  })

  it('never loses characters, even with overlapping lookahead matches', () => {
    const { matches } = runRegex('a(?=a)', 'g', 'aaa')
    const parts = highlight('aaa', matches)
    expect(parts.map((p) => p.text).join('')).toBe('aaa')
  })
})

describe('runRegex edge cases', () => {
  it('handles an empty pattern', () => {
    const { matches, error } = runRegex('', 'g', 'ab')
    expect(error).toBeUndefined()
    expect(matches.every((m) => m.value === '')).toBe(true)
  })

  it('handles empty input without matching', () => {
    const { matches } = runRegex('\\d', 'g', '')
    expect(matches).toEqual([])
  })

  it('counts unicode code points, not UTF-16 units, for surrogate pairs', () => {
    const { matches } = runRegex('\\p{Emoji}', 'gu', 'a😀b😀')
    expect(matches).toHaveLength(2)
    // Indices are UTF-16 offsets: 'a' (1) + first emoji (2 units) + 'b' (1).
    expect(matches[1].index).toBe(4)
  })

  it('reports a group that did not participate as undefined', () => {
    const { matches } = runRegex('(a)|(b)', 'g', 'b')
    expect(matches[0].groups[0]).toBeUndefined()
    expect(matches[0].groups[1]).toBe('b')
  })

  it('exposes named groups as undefined when they did not participate', () => {
    const { matches } = runRegex('(?<x>a)?(?<y>b)', 'g', 'b')
    expect(matches[0].named.x).toBeUndefined()
    expect(matches[0].named.y).toBe('b')
  })

  it('reports exact indices across multiline input with the m flag', () => {
    const { matches } = runRegex('^b', 'gm', 'a\nb\ncb')
    expect(matches.map((m) => m.index)).toEqual([2])
  })

  it('does not truncate when the limit equals the match count', () => {
    const { matches, truncated } = runRegex('a', 'g', 'aaa', 3)
    expect(matches).toHaveLength(3)
    expect(truncated).toBe(false)
  })

  it('scales to a large input without losing matches', () => {
    const input = 'x'.repeat(20000)
    const { matches } = runRegex('x', 'g', input, 1000)
    expect(matches).toHaveLength(1000)
    expect(matches[999].index).toBe(999)
  })

  it('handles a case-insensitive match', () => {
    const { matches } = runRegex('abc', 'gi', 'ABC abc AbC')
    expect(matches).toHaveLength(3)
  })
})

describe('highlight edge cases', () => {
  it('returns one unmatched run when there are no matches', () => {
    expect(highlight('hello', [])).toEqual([{ text: 'hello', match: false }])
  })

  it('returns nothing for empty input', () => {
    expect(highlight('', [])).toEqual([])
  })

  it('keeps unicode matches intact', () => {
    const { matches } = runRegex('😀', 'gu', 'a😀b')
    const parts = highlight('a😀b', matches)
    expect(parts.map((p) => p.text).join('')).toBe('a😀b')
    expect(parts.find((p) => p.match)?.text).toBe('😀')
  })

  it('tolerates unsorted matches', () => {
    const { matches } = runRegex('\\d', 'g', '1 2 3')
    const shuffled = [...matches].reverse()
    expect(highlight('1 2 3', shuffled).map((p) => p.text).join('')).toBe('1 2 3')
  })
})

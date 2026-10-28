import { describe, expect, it } from 'vitest'
import {
  analyse,
  compareSpecificity,
  findIssues,
  formatSpecificity,
  scoreSelectorList,
  specificityKey,
  splitSelectorList,
  splitSelectorListRaw,
  specificityOf,
} from './specificity'

const spec = (selector: string) => specificityOf(selector).specificity

describe('splitSelectorList', () => {
  it('splits on top-level commas', () => {
    expect(splitSelectorList('a, b')).toEqual(['a', 'b'])
  })

  it('keeps commas inside functional pseudos and attributes', () => {
    expect(splitSelectorList(':is(a, b), .c')).toEqual([':is(a, b)', '.c'])
    expect(splitSelectorList('[data-x="a,b"]')).toEqual(['[data-x="a,b"]'])
  })

  it('keeps commas inside nested pseudos', () => {
    expect(splitSelectorList(':is(.a, :not(.b, .c)), d')).toEqual([':is(.a, :not(.b, .c))', 'd'])
  })

  it('drops blank segments but keeps them raw', () => {
    expect(splitSelectorList('a, , b,')).toEqual(['a', 'b'])
    expect(splitSelectorListRaw('a, , b,')).toEqual(['a', '', 'b', ''])
  })
})

describe('specificityOf', () => {
  it('scores a type selector', () => {
    expect(spec('div')).toEqual({ ids: 0, classes: 0, elements: 1 })
  })

  it('scores a class', () => {
    expect(spec('.btn')).toEqual({ ids: 0, classes: 1, elements: 0 })
  })

  it('scores an id', () => {
    expect(spec('#app')).toEqual({ ids: 1, classes: 0, elements: 0 })
  })

  it('scores a compound selector', () => {
    expect(spec('div#app.btn')).toEqual({ ids: 1, classes: 1, elements: 1 })
  })

  it('ignores the universal selector', () => {
    expect(spec('*')).toEqual({ ids: 0, classes: 0, elements: 0 })
  })

  it('scores descendant and child combinators', () => {
    expect(spec('ul li a')).toEqual({ ids: 0, classes: 0, elements: 3 })
    expect(spec('ul > li')).toEqual({ ids: 0, classes: 0, elements: 2 })
  })

  it('scores sibling combinators', () => {
    expect(spec('h2 + p ~ span')).toEqual({ ids: 0, classes: 0, elements: 3 })
  })

  it('counts attribute selectors as classes', () => {
    expect(spec('[type="text"]')).toEqual({ ids: 0, classes: 1, elements: 0 })
  })

  it('counts pseudo-classes as classes and pseudo-elements as elements', () => {
    expect(spec('a:hover')).toEqual({ ids: 0, classes: 1, elements: 1 })
    expect(spec('p::before')).toEqual({ ids: 0, classes: 0, elements: 2 })
  })

  it('takes the most specific argument of :not() and :is()', () => {
    expect(spec(':not(.a)')).toEqual({ ids: 0, classes: 1, elements: 0 })
    expect(spec(':is(#a, .b)')).toEqual({ ids: 1, classes: 0, elements: 0 })
  })

  it('scores nested functional pseudos without double counting', () => {
    expect(spec(':is(.a, :not(#b))')).toEqual({ ids: 1, classes: 0, elements: 0 })
    expect(spec('li:not(:is(.a, .b))')).toEqual({ ids: 0, classes: 1, elements: 1 })
    expect(spec(':has(> img)')).toEqual({ ids: 0, classes: 0, elements: 1 })
    expect(spec(':has(.icon)')).toEqual({ ids: 0, classes: 1, elements: 0 })
  })

  it('gives :where() zero specificity', () => {
    expect(spec(':where(#a, .b)')).toEqual({ ids: 0, classes: 0, elements: 0 })
    expect(spec('div:where(.b)')).toEqual({ ids: 0, classes: 0, elements: 1 })
  })

  it('handles :nth-child() and its `of` clause', () => {
    expect(spec(':nth-child(2n+1)')).toEqual({ ids: 0, classes: 1, elements: 0 })
    expect(spec(':nth-child(2n of .item)')).toEqual({ ids: 0, classes: 2, elements: 0 })
    expect(spec('li:nth-last-child(odd)')).toEqual({ ids: 0, classes: 1, elements: 1 })
  })

  it('handles escaped characters in identifiers', () => {
    expect(spec('.foo\\:bar')).toEqual({ ids: 0, classes: 1, elements: 0 })
    expect(spec('#\\31 23')).toEqual({ ids: 1, classes: 0, elements: 0 })
  })

  it('flags !important', () => {
    expect(specificityOf('a !important').important).toBe(true)
    expect(specificityOf('a').important).toBe(false)
    expect(specificityOf('a!important').important).toBe(true)
  })

  it('does not count a hash inside an attribute string', () => {
    expect(spec('[href="#top"]')).toEqual({ ids: 0, classes: 1, elements: 0 })
  })
})

describe('compareSpecificity', () => {
  it('orders ids over classes over elements', () => {
    expect(compareSpecificity({ ids: 1, classes: 0, elements: 0 }, { ids: 0, classes: 9, elements: 9 })).toBeGreaterThan(0)
    expect(compareSpecificity({ ids: 0, classes: 1, elements: 0 }, { ids: 0, classes: 0, elements: 9 })).toBeGreaterThan(0)
  })

  it('treats equal triples as equal', () => {
    expect(compareSpecificity({ ids: 1, classes: 2, elements: 3 }, { ids: 1, classes: 2, elements: 3 })).toBe(0)
  })
})

describe('formatSpecificity / specificityKey', () => {
  it('renders the classic triple', () => {
    expect(formatSpecificity({ ids: 1, classes: 2, elements: 3 })).toBe('(1, 2, 3)')
  })

  it('keys a triple for equality checks', () => {
    expect(specificityKey({ ids: 1, classes: 2, elements: 3 })).toBe('1-2-3')
  })
})

describe('findIssues', () => {
  it('passes clean selectors', () => {
    expect(findIssues('.a, #b:hover, [type="x"]')).toEqual([])
  })

  it('flags a pasted rule set', () => {
    const issues = findIssues('.a { color: red }')
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/rule, not a selector/)
  })

  it('flags unbalanced parentheses and brackets', () => {
    expect(findIssues(':is(.a, .b')[0].message).toMatch(/parentheses/)
    expect(findIssues('[type="text"')[0].message).toMatch(/brackets/)
  })

  it('flags an unclosed quote', () => {
    expect(findIssues('[type="text]')[0].message).toMatch(/quote/)
  })

  it('keeps a quote closed across a comma', () => {
    expect(findIssues('[data-x="a,b"]')).toEqual([])
  })
})

describe('analyse', () => {
  it('finds the highest specificity and sorts the list', () => {
    const report = analyse('.a, #b, div')
    expect(formatSpecificity(report.max)).toBe('(1, 0, 0)')
    expect(report.sorted[0].selector).toBe('#b')
    expect(report.sorted[2].selector).toBe('div')
    expect(report.tiedTop).toBe(false)
  })

  it('reports a tie for the top score', () => {
    const report = analyse('#a, #b, .c')
    expect(report.tiedTop).toBe(true)
    expect(formatSpecificity(report.max)).toBe('(1, 0, 0)')
  })

  it('does not report a tie for a single selector', () => {
    expect(analyse('#a').tiedTop).toBe(false)
  })

  it('returns an empty report for blank input', () => {
    expect(scoreSelectorList('')).toEqual([])
    const report = analyse('')
    expect(report.max).toEqual({ ids: 0, classes: 0, elements: 0 })
    expect(report.sorted).toEqual([])
    expect(report.issues).toEqual([])
  })

  it('scores a large selector list without choking', () => {
    const input = Array.from({ length: 500 }, (_, i) => `.c${i} #i${i}`).join(', ')
    const report = analyse(input)
    expect(report.scores).toHaveLength(500)
    expect(formatSpecificity(report.max)).toBe('(1, 1, 0)')
  })
})

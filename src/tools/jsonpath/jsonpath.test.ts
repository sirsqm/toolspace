import { describe, expect, it } from 'vitest'
import {
  explainPath,
  JsonPathError,
  MAX_MATCHES,
  previewValue,
  query,
  runQuery,
  sliceIndices,
  stringifyValue,
  type JsonValue,
} from './jsonpath'

const DOC: JsonValue = {
  store: {
    book: [
      { title: 'Refactoring', price: 30, tags: ['code', 'craft'] },
      { title: 'Clean Code', price: 20, tags: ['code'] },
      { title: 'The Art', price: 45, tags: [] },
    ],
    bicycle: { color: 'red', price: 120 },
  },
  cheap: true,
}

const values = (path: string, doc: JsonValue = DOC) => query(doc, path).map((match) => match.value)

describe('query: basics', () => {
  it('reads a root property', () => {
    expect(values('$.cheap')).toEqual([true])
  })

  it('reads nested properties with dot and bracket forms', () => {
    expect(values('$.store.bicycle.color')).toEqual(['red'])
    expect(values("$.store['bicycle'].color")).toEqual(['red'])
  })

  it('reads an array index, including negative', () => {
    expect(values('$.store.book[0].title')).toEqual(['Refactoring'])
    expect(values('$.store.book[-1].title')).toEqual(['The Art'])
  })

  it('reports paths for every match', () => {
    expect(query(DOC, '$.store.book[1].title')[0].path).toBe('$.store.book[1].title')
  })

  it('returns the document itself for "$"', () => {
    expect(query(DOC, '$')).toEqual([{ path: '$', value: DOC }])
  })

  it('tolerates surrounding whitespace', () => {
    expect(values('  $.cheap  ')).toEqual([true])
  })
})

describe('query: wildcards and descent', () => {
  it('expands a wildcard over arrays and objects', () => {
    expect(values('$.store.book[*].price')).toEqual([30, 20, 45])
    expect(values('$.store.bicycle.*')).toEqual(['red', 120])
  })

  it('walks recursively in document order', () => {
    expect(values('$..price')).toEqual([30, 20, 45, 120])
    expect(values('$..tags[0]')).toEqual(['code', 'code'])
  })

  it('$..* visits every descendant', () => {
    expect(query({ a: { b: 1 } }, '$..*').map((m) => m.path)).toEqual(['$.a', '$.a.b'])
  })

  it('descends into arrays by name', () => {
    expect(query({ a: [{ b: 1 }, { b: 2 }] }, '$..b').map((m) => m.value)).toEqual([1, 2])
  })
})

describe('query: slices', () => {
  it('takes a plain slice', () => {
    expect(values('$.store.book[0:2].title')).toEqual(['Refactoring', 'Clean Code'])
    expect(values('$.store.book[1:].title')).toEqual(['Clean Code', 'The Art'])
    expect(values('$.store.book[:2].title')).toEqual(['Refactoring', 'Clean Code'])
  })

  it('honours a step', () => {
    expect(values('$.store.book[::2].title')).toEqual(['Refactoring', 'The Art'])
  })

  it('walks backwards with a negative step', () => {
    expect(values('$.store.book[::-1].title')).toEqual(['The Art', 'Clean Code', 'Refactoring'])
    expect(values('$.store.book[2:0:-1].title')).toEqual(['The Art', 'Clean Code'])
  })

  it('clamps out-of-range bounds instead of erroring', () => {
    expect(values('$.store.book[-99:99].title')).toEqual(['Refactoring', 'Clean Code', 'The Art'])
    expect(values('$.store.book[10:20]')).toEqual([])
  })

  it('matches Python for negative bounds', () => {
    expect(sliceIndices(5, { start: -3, end: -1, step: 1 })).toEqual([2, 3])
    expect(sliceIndices(5, { end: -2, step: 1 })).toEqual([0, 1, 2])
  })
})

describe('query: unions', () => {
  it('selects several indices', () => {
    expect(values('$.store.book[0,2].title')).toEqual(['Refactoring', 'The Art'])
  })

  it('selects several names', () => {
    expect(values("$.store['bicycle','book']")).toHaveLength(2)
  })

  it('keeps a comma inside a quoted name', () => {
    expect(values("$['a,b','c']", { 'a,b': 1, c: 2 })).toEqual([1, 2])
  })

  it('ignores selectors that do not apply', () => {
    expect(values('$.store.book[0,99].title')).toEqual(['Refactoring'])
  })
})

describe('query: filters', () => {
  it('filters numbers', () => {
    expect(values('$.store.book[?(@.price < 30)].title')).toEqual(['Clean Code'])
    expect(values('$.store.book[?(@.price >= 30)].title')).toEqual(['Refactoring', 'The Art'])
  })

  it('filters strings', () => {
    expect(values('$.store.book[?(@.title == "Clean Code")].price')).toEqual([20])
  })

  it('compares deep values by structure', () => {
    expect(values('$.store.book[?(@.tags == ["code"])].title')).toEqual(['Clean Code'])
  })

  it('filters on existence, so an empty array still matches', () => {
    expect(values('$.store.book[?(@.tags)].title')).toEqual(['Refactoring', 'Clean Code', 'The Art'])
    expect(values('$.store.book[?(@.missing)]')).toEqual([])
  })

  it('filters with a regex', () => {
    expect(values('$.store.book[?(@.title =~ "^Clean")].title')).toEqual(['Clean Code'])
  })

  it('combines conditions with && and ||', () => {
    // `@.tags` is an existence test, so the empty array still counts as present.
    expect(values('$.store.book[?(@.price > 20 && @.tags)].title')).toEqual(['Refactoring', 'The Art'])
    expect(values('$.store.book[?(@.price > 20 && @.tags[0])].title')).toEqual(['Refactoring'])
    expect(values('$.store.book[?(@.price > 40 || @.title == "Clean Code")].title')).toEqual(['Clean Code', 'The Art'])
  })

  it('negates a condition', () => {
    expect(values('$.store.book[?(!@.tags)].title')).toEqual([])
    expect(values('$.store.book[?( @.price < 40 && !(@.title == "Clean Code"))].title')).toEqual(['Refactoring'])
  })

  it('supports a filter without the wrapping parentheses', () => {
    expect(values('$.store.book[?@.price < 30].title')).toEqual(['Clean Code'])
  })

  it('compares two node values when both sides are paths', () => {
    expect(values('$.store.book[?(@.price == @.price)]')).toHaveLength(3)
  })

  it('reads bracket notation and indices inside a filter', () => {
    expect(values("$.store.book[?(@['title'] == 'The Art')].price")).toEqual([45])
    expect(values('$.store.book[?(@.tags[1] == "craft")].title')).toEqual(['Refactoring'])
  })

  it('reads nested paths inside a filter', () => {
    expect(values('$.store.book[?(@.tags[0] == "code")].title')).toEqual(['Refactoring', 'Clean Code'])
  })

  it('does not compare a number to a numeric string', () => {
    expect(values('$.store.book[?(@.price == "30")]')).toEqual([])
  })

  it('only orders like types', () => {
    expect(values('$.store.book[?(@.title < 30)]')).toEqual([])
    expect(values('$.store.book[?(@.title > "Clean Code")].title')).toEqual(['Refactoring', 'The Art'])
  })

  it('matches booleans and null literals', () => {
    const doc: JsonValue = [{ ok: true }, { ok: false }, { ok: null }]
    expect(query(doc, '$[?(@.ok == true)]').map((m) => m.value)).toEqual([{ ok: true }])
    expect(query(doc, '$[?(@.ok == null)]').map((m) => m.value)).toEqual([{ ok: null }])
    expect(query(doc, '$[?(@.ok != null)]')).toHaveLength(2)
  })

  it('filters over object members, not only arrays', () => {
    // A filter over an object selects the member values that satisfy it.
    expect(values('$.store[?(@.price > 100)].price')).toEqual([120])
  })
})

describe('query: documents and edge cases', () => {
  it('queries a bare array document', () => {
    expect(values('$[1]', [10, 20, 30])).toEqual([20])
    expect(values('$[*]', [10, 20])).toEqual([10, 20])
  })

  it('queries a bare scalar document', () => {
    expect(values('$', 42)).toEqual([42])
    expect(values('$', null)).toEqual([null])
  })

  it('returns nothing for a missing path', () => {
    expect(query(DOC, '$.store.nope')).toEqual([])
    expect(query(DOC, '$.store.book[99]')).toEqual([])
    expect(query(DOC, '$.cheap.deeper')).toEqual([])
  })

  it('finds keys that need bracket quoting', () => {
    const doc: JsonValue = { 'a.b': { 'c d': 1 } }
    expect(values("$['a.b']['c d']", doc)).toEqual([1])
    expect(query(doc, "$['a.b']['c d']")[0].path).toBe("$['a.b']['c d']")
  })

  it('handles a key containing a quote', () => {
    const doc: JsonValue = { "it's": 1 }
    const matches = query(doc, "$['it\\'s']")
    expect(matches.map((m) => m.value)).toEqual([1])
    expect(matches[0].path).toBe("$['it\\'s']")
  })

  it('handles unicode keys and values', () => {
    expect(values("$['ключ']", { ключ: 'значение' })).toEqual(['значение'])
    expect(values('$.emoji', { emoji: '🙂' })).toEqual(['🙂'])
  })

  it('is not confused by a key named like a wildcard', () => {
    expect(values("$['*']", { '*': 1 })).toEqual([1])
  })
})

describe('query: errors', () => {
  it('explains an empty path', () => {
    expect(() => query(DOC, '')).toThrow(/Enter a path/)
    expect(() => query(DOC, '   ')).toThrow(JsonPathError)
  })

  it('explains a missing root', () => {
    expect(() => query(DOC, 'store.book')).toThrow(/must start with "\$"/)
  })

  it('explains an unclosed bracket', () => {
    expect(() => query(DOC, '$.store[')).toThrow(/Unclosed/)
  })

  it('explains an empty bracket', () => {
    expect(() => query(DOC, '$.store[]')).toThrow(/Empty/)
  })

  it('explains a zero slice step', () => {
    expect(() => query(DOC, '$.store.book[0:2:0]')).toThrow(/cannot be zero/)
  })

  it('explains a non-integer slice bound', () => {
    expect(() => query(DOC, '$.store.book[1.5:2]')).toThrow(/whole numbers/)
  })

  it('explains an unreadable filter', () => {
    expect(() => query(DOC, '$.store.book[?(@.x & 1)]')).toThrow(/Unexpected/)
    expect(() => query(DOC, '$.store.book[?()]')).toThrow(/needs a condition/)
  })

  it('explains an invalid regex', () => {
    expect(() => query(DOC, '$.store.book[?(@.title =~ "([")]')).toThrow(/not a valid pattern/)
  })

  it('requires a quoted pattern for =~', () => {
    expect(() => query(DOC, '$.store.book[?(@.title =~ @.title)]')).toThrow(/quoted pattern/)
  })

  it('points at a bad character', () => {
    expect(() => query(DOC, '$.store.book[*] &')).toThrow(/position/)
  })

  it('never evaluates code in a filter', () => {
    expect(() => query(DOC, '$.store.book[?(@.price > process.exit(1))]')).toThrow(JsonPathError)
    expect(() => query(DOC, '$.store.book[?(@.price == (1+1))]')).toThrow(JsonPathError)
  })

  it('reports the class so the UI can tell path errors from document errors', () => {
    try {
      query(DOC, 'nope')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(JsonPathError)
    }
  })
})

describe('runQuery: guard rails', () => {
  const big: JsonValue = Array.from({ length: 5000 }, (_, index) => ({ id: index, nested: { id: index } }))

  it('caps the number of matches and says so', () => {
    const capped = runQuery(big, '$..id', { limit: 100 })
    expect(capped.matches).toHaveLength(100)
    expect(capped.truncated).toBe(true)
  })

  it('does not report truncation when the answer fits', () => {
    const full = runQuery(DOC, '$..price')
    expect(full.truncated).toBe(false)
  })

  it('stays under the default cap for a large document', () => {
    const huge: JsonValue = Array.from({ length: MAX_MATCHES + 50 }, (_, index) => index)
    const capped = runQuery(huge, '$[*]')
    expect(capped.matches).toHaveLength(MAX_MATCHES)
    expect(capped.truncated).toBe(true)
  })

  it('answers a deep document without recursing', () => {
    let deep: JsonValue = 1
    for (let i = 0; i < 5000; i++) deep = { next: deep }
    const found = runQuery(deep, '$..next')
    expect(found.matches.length).toBeGreaterThan(0)
  })

  it('runs the default limit when none is given', () => {
    expect(runQuery(DOC, '$.cheap').matches).toHaveLength(1)
  })
})

describe('presentation helpers', () => {
  it('pretty-prints a value', () => {
    expect(stringifyValue({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}')
    expect(stringifyValue(undefined as unknown as JsonValue)).toBe('null')
  })

  it('keeps a preview on one line and elides a long one', () => {
    expect(previewValue({ a: 1 })).toBe('{"a":1}')
    expect(previewValue('text')).toBe('"text"')
    const long = previewValue('x'.repeat(1000))
    expect(long.endsWith('…')).toBe(true)
    expect(long).not.toContain('\n')
  })

  it('explains a path in plain words', () => {
    expect(explainPath('$.store.book[*].title')).toEqual([
      'child "store"',
      'child "book"',
      'every child',
      'child "title"',
    ])
    expect(explainPath('$..price')).toEqual(['any descendant named "price"'])
    expect(explainPath('$.store.book[0:2]')[2]).toBe('slice [0:2]')
    expect(explainPath('$.store.book[?(@.price < 30)]')[2]).toBe('filter @.price < 30')
    expect(explainPath('$[0,1]')).toEqual(['one of 0, 1'])
  })

  it('explains a negative index and a recursive wildcard', () => {
    expect(explainPath('$.a[-1]')).toEqual(['child "a"', 'index -1 (from the end)'])
    expect(explainPath('$..*')).toEqual(['every descendant'])
  })
})

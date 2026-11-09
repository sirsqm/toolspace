import { describe, expect, it } from 'vitest'
import {
  buildUrl,
  decodeComponent,
  decodeUrl,
  duplicateKeys,
  encodeComponent,
  formEncode,
  parseUrl,
  safeDecode,
  urlParts,
} from './url'

describe('component encoding', () => {
  it('round-trips reserved characters', () => {
    const text = 'a b&c=d?e/f'
    expect(decodeComponent(encodeComponent(text))).toBe(text)
  })

  it('encodes spaces as %20', () => {
    expect(encodeComponent('a b')).toBe('a%20b')
  })
})

describe('safeDecode', () => {
  it('decodes a multi-byte UTF-8 run that per-token decoding cannot', () => {
    expect(safeDecode('%C3%A9')).toBe('é')
    expect(safeDecode('caf%C3%A9')).toBe('café')
    expect(safeDecode('%E2%9C%93')).toBe('✓')
  })

  it('leaves malformed sequences untouched', () => {
    expect(safeDecode('%zz')).toBe('%zz')
    expect(safeDecode('a%')).toBe('a%')
    expect(safeDecode('%E2%9C')).toBe('%E2%9C')
  })

  it('keeps a valid run even when a later run is broken', () => {
    expect(safeDecode('%C3%A9-%zz')).toBe('é-%zz')
  })

  it('treats + as space only when asked', () => {
    expect(safeDecode('a+b')).toBe('a b')
    expect(safeDecode('a+b', false)).toBe('a+b')
  })
})

describe('decodeUrl', () => {
  it('decodes a full URL and keeps + literal', () => {
    expect(decodeUrl('https://a.dev/p?q=a+b&x=%C3%A9')).toBe('https://a.dev/p?q=a+b&x=é')
  })

  it('tolerates a malformed percent sequence', () => {
    expect(decodeUrl('https://a.dev/%zz')).toBe('https://a.dev/%zz')
  })
})

describe('parseUrl', () => {
  it('splits base, params and hash', () => {
    const parsed = parseUrl('https://a.dev/p?x=1&y=2#frag')
    expect(parsed.base).toBe('https://a.dev/p')
    expect(parsed.params).toEqual([
      { key: 'x', value: '1' },
      { key: 'y', value: '2' },
    ])
    expect(parsed.hash).toBe('frag')
  })

  it('decodes values and treats + as space', () => {
    const parsed = parseUrl('/search?q=hello+world&q=a%26b')
    expect(parsed.params).toEqual([
      { key: 'q', value: 'hello world' },
      { key: 'q', value: 'a&b' },
    ])
  })

  it('decodes multi-byte values', () => {
    const parsed = parseUrl('/s?q=caf%C3%A9&city=M%C3%BCnchen')
    expect(parsed.params).toEqual([
      { key: 'q', value: 'café' },
      { key: 'city', value: 'München' },
    ])
  })

  it('supports valueless keys and drops blanks', () => {
    const parsed = parseUrl('/p?flag&&=oops&ok=1')
    expect(parsed.params).toEqual([
      { key: 'flag', value: '' },
      { key: 'ok', value: '1' },
    ])
  })

  it('handles a URL with no query', () => {
    expect(parseUrl('/plain')).toEqual({ base: '/plain', params: [], hash: '' })
  })

  it('keeps everything after the first ? as the query', () => {
    const parsed = parseUrl('/p?a=1?b=2')
    expect(parsed.params).toEqual([{ key: 'a', value: '1?b=2' }])
  })
})

describe('buildUrl', () => {
  it('encodes params when asked', () => {
    const url = buildUrl('/p', [{ key: 'q', value: 'a b&c' }], '', { encode: true, sort: false })
    expect(url).toBe('/p?q=a%20b%26c')
  })

  it('encodes spaces as + in form mode', () => {
    const url = buildUrl('/p', [{ key: 'q', value: 'a b' }], '', { encode: true, formSpaces: true, sort: false })
    expect(url).toBe('/p?q=a+b')
  })

  it('encodes the base and hash when asked', () => {
    const url = buildUrl('https://a.dev/a b', [], 'a b', { encode: true, encodeBase: true, sort: false })
    expect(url).toBe('https://a.dev/a%20b#a%20b')
  })

  it('sorts keys when asked', () => {
    const url = buildUrl('/p', [{ key: 'b', value: '2' }, { key: 'a', value: '1' }], '', { encode: false, sort: true })
    expect(url).toBe('/p?a=1&b=2')
  })

  it('drops params with a blank key', () => {
    const url = buildUrl('/p', [{ key: '  ', value: 'x' }, { key: 'a', value: '1' }], '', { encode: true, sort: false })
    expect(url).toBe('/p?a=1')
  })

  it('renders valueless params and reattaches the hash', () => {
    const url = buildUrl('/p', [{ key: 'flag', value: '' }], 'top', { encode: true, sort: false })
    expect(url).toBe('/p?flag#top')
  })

  it('round-trips a parsed URL', () => {
    const source = 'https://a.dev/p?x=1&y=hello%20world#z'
    const parsed = parseUrl(source)
    expect(buildUrl(parsed.base, parsed.params, parsed.hash, { encode: true, sort: false })).toBe(source)
  })
})

describe('formEncode', () => {
  it('matches URLSearchParams for spaces and reserved characters', () => {
    const sample = 'a b!c\'d(e)f*g~'
    expect(formEncode(sample)).toBe(new URLSearchParams([['k', sample]]).toString().slice(2))
  })
})

describe('duplicateKeys', () => {
  it('reports every repeated key with its positions', () => {
    const groups = duplicateKeys([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
      { key: 'a', value: '3' },
    ])
    expect(groups).toEqual([{ key: 'a', indices: [0, 2] }])
  })

  it('is empty when all keys are unique', () => {
    expect(duplicateKeys([{ key: 'a', value: '1' }, { key: 'b', value: '2' }])).toEqual([])
  })
})

describe('urlParts', () => {
  it('splits a full URL into its five components', () => {
    expect(urlParts('https://user@a.dev:8080/p/q?x=1#top')).toEqual({
      scheme: 'https',
      authority: 'user@a.dev:8080',
      path: '/p/q',
      query: 'x=1',
      hash: 'top',
    })
  })

  it('handles a protocol-relative URL', () => {
    expect(urlParts('//cdn.example.com/a.js')).toEqual({
      scheme: '',
      authority: 'cdn.example.com',
      path: '/a.js',
      query: '',
      hash: '',
    })
  })

  it('handles a bare path without throwing', () => {
    expect(urlParts('/just/a/path')).toEqual({
      scheme: '',
      authority: '',
      path: '/just/a/path',
      query: '',
      hash: '',
    })
  })
})

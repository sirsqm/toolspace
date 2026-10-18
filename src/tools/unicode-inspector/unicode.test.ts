import { describe, expect, it } from 'vitest'
import { decodeHtml, encodeHtml, inspect, summarise } from './unicode'

describe('inspect', () => {
  it('handles BMP characters', () => {
    const [info] = inspect('A')
    expect(info.codePoint).toBe(65)
    expect(info.hex).toBe('41')
    expect(info.unicode).toBe('U+0041')
    expect(info.js).toBe('\\u0041')
    expect(info.html).toBe('&#65;')
  })

  it('handles astral characters as one entry', () => {
    const infos = inspect('😀')
    expect(infos).toHaveLength(1)
    expect(infos[0].codePoint).toBe(0x1f600)
    expect(infos[0].js).toBe('\\u{1F600}')
  })

  it('tracks UTF-16 indices across surrogate pairs', () => {
    const infos = inspect('a😀b')
    expect(infos.map((i) => i.index)).toEqual([0, 1, 3])
    expect(infos[2].char).toBe('b')
  })
})

describe('encodeHtml', () => {
  it('escapes the named entities', () => {
    expect(encodeHtml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;')
  })

  it('encodes non-ASCII numerically', () => {
    expect(encodeHtml('é')).toBe('&#233;')
  })
})

describe('decodeHtml', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtml('&lt;a&gt; &amp; &#233; &#x1F600;')).toBe('<a> & é 😀')
  })

  it('round-trips through encode', () => {
    const source = '<héllo> & "world"'
    expect(decodeHtml(encodeHtml(source))).toBe(source)
  })
})

describe('inspect boundaries', () => {
  it('returns nothing for empty input', () => {
    expect(inspect('')).toEqual([])
  })

  it('stops at the limit instead of scanning everything', () => {
    expect(inspect('abcdef', 2).map((i) => i.char)).toEqual(['a', 'b'])
  })

  it('treats a limit of zero as no rows', () => {
    expect(inspect('abc', 0)).toEqual([])
  })

  it('reports UTF-8 byte length for 1-, 2-, 3- and 4-byte characters', () => {
    expect(inspect('a')[0].utf8).toBe('61')
    expect(inspect('é')[0].utf8).toBe('C3 A9')
    expect(inspect('€')[0].utf8).toBe('E2 82 AC')
    expect(inspect('😀')[0].utf8).toBe('F0 9F 98 80')
    expect(inspect('😀')[0].utf8Length).toBe(4)
  })

  it('escapes a BMP character with a four-digit \\u code', () => {
    expect(inspect('é')[0].js).toBe('\\u00E9')
  })

  it('pads short code points to four hex digits in the U+ form', () => {
    expect(inspect('a')[0].unicode).toBe('U+0061')
  })

  it('gives invisible characters a visible stand-in', () => {
    expect(inspect(' ')[0].display).toBe('␠')
    expect(inspect('\t')[0].display).toBe('␉')
    expect(inspect('\u00a0')[0].display).toBe('␣')
    expect(inspect('\u200b')[0].display).toBe('⟨200B⟩')
    expect(inspect('\ufeff')[0].display).toBe('⟨FEFF⟩')
  })

  it('marks a combining mark so it cannot be mistaken for a bare letter', () => {
    expect(inspect('\u0301')[0].display).toBe('◌\u0301')
  })

  it('flags an unpaired surrogate and names it', () => {
    const [info] = inspect('\ud800')
    expect(info.display).toBe('⟨D800⟩')
    expect(info.category).toBe('Surrogate (Cs)')
    expect(info.name).toBe('LONE SURROGATE (not a character)')
  })

  it('leaves a valid surrogate pair alone', () => {
    expect(inspect('😀')[0].name).toBe('')
    expect(inspect('😀')[0].display).toBe('😀')
  })

  it('names the characters worth naming', () => {
    expect(inspect('\u00a0')[0].name).toBe('NO-BREAK SPACE')
    expect(inspect('a')[0].name).toBe('')
  })

  it('classifies letters, digits, punctuation and control characters', () => {
    expect(inspect('A')[0].category).toBe('Uppercase letter (Lu)')
    expect(inspect('a')[0].category).toBe('Lowercase letter (Ll)')
    expect(inspect('7')[0].category).toBe('Decimal digit (Nd)')
    expect(inspect('€')[0].category).toBe('Currency symbol (Sc)')
    expect(inspect('\n')[0].category).toBe('Control (Cc)')
    expect(inspect('\u200b')[0].category).toBe('Format (Cf)')
    expect(inspect(' ')[0].category).toBe('Space separator (Zs)')
    expect(inspect('😀')[0].category).toBe('Other symbol (So)')
  })
})

describe('decodeHtml invalid references', () => {
  it('leaves an out-of-range numeric reference alone instead of throwing', () => {
    expect(() => decodeHtml('&#9999999999;')).not.toThrow()
    expect(decodeHtml('&#9999999999;')).toBe('&#9999999999;')
  })

  it('leaves a surrogate numeric reference alone', () => {
    expect(decodeHtml('&#55296;')).toBe('&#55296;')
  })

  it('leaves an unknown named reference alone', () => {
    expect(decodeHtml('&nosuch;')).toBe('&nosuch;')
  })

  it('keeps the surrounding text when one reference is invalid', () => {
    expect(decodeHtml('a&#9999999999;b')).toBe('a&#9999999999;b')
  })

  it('accepts numeric references without a semicolon', () => {
    expect(decodeHtml('&#169')).toBe('©')
    expect(decodeHtml('&#xA9')).toBe('©')
  })

  it('decodes a wide range of named references', () => {
    expect(decodeHtml('&mdash;&nbsp;&copy;&hellip;')).toBe('—\u00a0©…')
    expect(decodeHtml('&rarr;')).toBe('→')
  })

  it('handles a lone ampersand and an empty string', () => {
    expect(decodeHtml('&')).toBe('&')
    expect(decodeHtml('')).toBe('')
  })
})

describe('summarise', () => {
  it('counts an empty string as zeroes', () => {
    expect(summarise('')).toEqual({
      codePoints: 0,
      utf16Units: 0,
      utf8Bytes: 0,
      graphemes: 0,
      ascii: 0,
      nonAscii: 0,
      unprintable: 0,
      loneSurrogates: 0,
    })
  })

  it('separates code points, UTF-16 units and UTF-8 bytes for an emoji', () => {
    const totals = summarise('😀')
    expect(totals.codePoints).toBe(1)
    expect(totals.utf16Units).toBe(2)
    expect(totals.utf8Bytes).toBe(4)
    expect(totals.graphemes).toBe(1)
  })

  it('splits ASCII from everything else', () => {
    const totals = summarise('ab é 😀')
    expect(totals.ascii).toBe(4)
    expect(totals.nonAscii).toBe(2)
  })

  it('counts invisible characters', () => {
    expect(summarise('a\u200b\u00a0b').unprintable).toBe(1)
  })

  it('counts unpaired surrogates so a lossy byte count can be flagged', () => {
    expect(summarise('a').loneSurrogates).toBe(0)
    expect(summarise('\ud800').loneSurrogates).toBe(1)
    expect(summarise('😀').loneSurrogates).toBe(0)
  })

  it('handles a large input without losing count', () => {
    const totals = summarise('a'.repeat(100000))
    expect(totals.codePoints).toBe(100000)
    expect(totals.utf8Bytes).toBe(100000)
  })
})

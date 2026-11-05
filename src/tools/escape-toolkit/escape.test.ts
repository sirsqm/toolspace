import { describe, expect, it } from 'vitest'
import {
  escape,
  EscapeError,
  EXAMPLES,
  FLAVORS,
  FLAVOR_NOTES,
  unescape,
  type Flavor,
} from './escape'

describe('json/javascript escaping', () => {
  it('escapes quotes and newlines', () => {
    expect(escape('a"b\nc', 'json')).toBe('a\\"b\\nc')
  })

  it('round-trips', () => {
    const text = 'he said "hi"\tand left\\'
    expect(unescape(escape(text, 'json'), 'json')).toBe(text)
  })

  it('reports malformed input instead of silently dropping it', () => {
    // A lone backslash is not a valid JSON escape.
    expect(() => unescape('a\\', 'json')).toThrow(EscapeError)
    expect(() => unescape('a\\', 'json')).toThrow(/JSON string/)
  })
})

describe('html/xml escaping', () => {
  it('escapes the five dangerous characters', () => {
    expect(escape('<a href="x">&\'</a>', 'html')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })

  it('decodes named and numeric entities', () => {
    expect(unescape('&lt;&amp;&gt;&#39;&#x41;', 'html')).toBe(`<&>'A`)
  })

  it('leaves a lone surrogate entity alone', () => {
    expect(unescape('&#xD800;', 'html')).toBe('&#xD800;')
    expect(unescape('&#x110000;', 'html')).toBe('&#x110000;')
  })

  it('round-trips', () => {
    expect(unescape(escape('<b>"x"</b>', 'xml'), 'xml')).toBe('<b>"x"</b>')
  })
})

describe('url escaping', () => {
  it('encodes and decodes a component', () => {
    expect(escape('a b/c?d=1', 'url')).toBe('a%20b%2Fc%3Fd%3D1')
    expect(unescape('a%20b', 'url')).toBe('a b')
  })

  it('reports a truncated escape sequence', () => {
    expect(() => unescape('100%', 'url')).toThrow(EscapeError)
    expect(() => unescape('100%', 'url')).toThrow(/percent-encoding/)
  })
})

describe('sql escaping', () => {
  it('doubles single quotes', () => {
    expect(escape("O'Brien", 'sql')).toBe("O''Brien")
    expect(unescape("O''Brien", 'sql')).toBe("O'Brien")
  })
})

describe('shell escaping', () => {
  it('wraps in single quotes and handles embedded quotes', () => {
    expect(escape('a b', 'shell')).toBe("'a b'")
    expect(unescape(escape("it's", 'shell'), 'shell')).toBe("it's")
  })
})

describe('regex escaping', () => {
  it('escapes metacharacters and reverses', () => {
    expect(escape('a.b*c', 'regex')).toBe('a\\.b\\*c')
    expect(unescape('a\\.b\\*c', 'regex')).toBe('a.b*c')
  })

  it('leaves plain text untouched', () => {
    expect(escape('abc', 'regex')).toBe('abc')
  })
})

describe('csv escaping', () => {
  it('quotes fields containing commas or quotes', () => {
    expect(escape('a,b', 'csv')).toBe('"a,b"')
    expect(escape('say "hi"', 'csv')).toBe('"say ""hi"""')
  })

  it('neutralises formula prefixes', () => {
    expect(escape('=1+1', 'csv')).toBe("'=1+1")
  })

  it('round-trips', () => {
    const text = 'a,b'
    expect(unescape(escape(text, 'csv'), 'csv')).toBe(text)
  })

  it('returns the input unchanged for an unknown flavour', () => {
    expect(escape('x', 'bogus' as Flavor)).toBe('x')
    expect(unescape('x', 'bogus' as Flavor)).toBe('x')
  })
})

describe('flavour metadata', () => {
  it('has a hint and an example for every flavour', () => {
    for (const item of FLAVORS) {
      expect(FLAVOR_NOTES[item.value]).toBeTruthy()
      expect(EXAMPLES[item.value]).toBeTruthy()
    }
  })

  it('examples actually change when escaped for their own flavour', () => {
    for (const item of FLAVORS) {
      // Every example contains something the flavour has to touch.
      expect(escape(EXAMPLES[item.value], item.value)).not.toBe(EXAMPLES[item.value])
    }
  })
})

describe('unicode', () => {
  it('escapes non-ASCII JSON as-is and round-trips', () => {
    const text = 'café — 日本語'
    expect(unescape(escape(text, 'json'), 'json')).toBe(text)
  })

  it('percent-encodes unicode for URLs', () => {
    expect(escape('café', 'url')).toBe('caf%C3%A9')
    expect(unescape('caf%C3%A9', 'url')).toBe('café')
  })
})

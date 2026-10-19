import { describe, expect, it } from 'vitest'
import { bounds, changeKind, compareVersions, describeParts, describeRange, format, isStable, nextVersions, parse, satisfies, SemverError } from './semver'

describe('parse', () => {
  it('parses a full version', () => {
    expect(parse('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [], build: [] })
  })

  it('parses prerelease and build metadata', () => {
    expect(parse('1.0.0-alpha.1+build.5')).toEqual({
      major: 1, minor: 0, patch: 0, prerelease: ['alpha', '1'], build: ['build', '5'],
    })
  })

  it('accepts a leading v', () => {
    expect(parse('v2.0.1').major).toBe(2)
  })

  it('rejects malformed versions', () => {
    expect(() => parse('1.2')).toThrow(SemverError)
    expect(() => parse('nope')).toThrow(SemverError)
  })
})

describe('compare', () => {
  it('orders by major, minor then patch', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('orders prereleases below releases', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
  })
})

describe('isStable', () => {
  it('treats prereleases as unstable', () => {
    expect(isStable(parse('1.0.0'))).toBe(true)
    expect(isStable(parse('1.0.0-beta'))).toBe(false)
  })
})

describe('nextVersions', () => {
  it('suggests the three bumps', () => {
    expect(nextVersions(parse('1.2.3')).map((b) => b.version)).toEqual(['1.2.4', '1.3.0', '2.0.0'])
  })
})

describe('satisfies', () => {
  it('matches exact versions', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true)
    expect(satisfies('1.2.4', '1.2.3')).toBe(false)
  })

  it('handles comparators', () => {
    expect(satisfies('1.5.0', '>=1.2.0')).toBe(true)
    expect(satisfies('1.1.0', '>=1.2.0')).toBe(false)
    expect(satisfies('1.5.0', '>=1.2.0 <2.0.0')).toBe(true)
    expect(satisfies('2.0.0', '>=1.2.0 <2.0.0')).toBe(false)
  })

  it('handles caret ranges', () => {
    expect(satisfies('1.9.0', '^1.2.3')).toBe(true)
    expect(satisfies('2.0.0', '^1.2.3')).toBe(false)
    expect(satisfies('0.2.5', '^0.2.3')).toBe(true)
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false)
  })

  it('handles tilde ranges', () => {
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true)
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false)
  })

  it('handles wildcards', () => {
    expect(satisfies('1.9.0', '1.x')).toBe(true)
    expect(satisfies('2.0.0', '1.x')).toBe(false)
    expect(satisfies('1.2.9', '1.2.x')).toBe(true)
    expect(satisfies('9.9.9', '*')).toBe(true)
  })

  it('handles hyphen ranges', () => {
    expect(satisfies('1.5.0', '1.2.3 - 2.0.0')).toBe(true)
    expect(satisfies('2.0.1', '1.2.3 - 2.0.0')).toBe(false)
  })

  it('handles unions', () => {
    expect(satisfies('3.0.0', '^1.0.0 || ^3.0.0')).toBe(true)
    expect(satisfies('2.0.0', '^1.0.0 || ^3.0.0')).toBe(false)
  })
})

describe('describeRange', () => {
  it('explains each range shape', () => {
    expect(describeRange('*')).toMatch(/Any/)
    expect(describeRange('^1.2.3')).toMatch(/Compatible/)
    expect(describeRange('~1.2.3')).toMatch(/Approximately|Patch-level/)
    expect(describeRange('1.2.3 - 2.0.0')).toMatch(/Between/)
    expect(describeRange('1.x')).toMatch(/wildcard/)
    expect(describeRange('^1 || ^3')).toMatch(/2 alternatives/)
  })
})

describe('format', () => {
  it('round-trips prerelease and build metadata', () => {
    expect(format(parse('1.0.0-alpha.1+build.5'))).toBe('1.0.0-alpha.1+build.5')
    expect(format(parse('v2.3.4'))).toBe('2.3.4')
  })
})

describe('describeParts', () => {
  it('names the parts that are present', () => {
    expect(describeParts(parse('1.2.3')).map((part) => part.label)).toEqual(['Major', 'Minor', 'Patch'])
    expect(describeParts(parse('1.2.3-beta.2+build')).map((part) => part.label)).toEqual([
      'Major', 'Minor', 'Patch', 'Prerelease', 'Build metadata',
    ])
  })
})

describe('changeKind', () => {
  it('names the kind of change under Semantic Versioning', () => {
    expect(changeKind(parse('1.2.3'), parse('1.2.4')).label).toBe('fix')
    expect(changeKind(parse('1.2.3'), parse('1.3.0')).label).toBe('new feature')
    expect(changeKind(parse('1.2.3'), parse('2.0.0')).label).toBe('breaking change')
    expect(changeKind(parse('1.2.3'), parse('1.2.3')).label).toBe('no change')
  })

  it('treats a zero-major minor bump as breaking, like npm', () => {
    expect(changeKind(parse('0.2.5'), parse('0.3.0')).tone).toBe('warn')
    expect(changeKind(parse('0.2.5'), parse('0.2.6')).label).toBe('fix')
    expect(changeKind(parse('0.2.5'), parse('1.0.0')).label).toBe('breaking change')
  })
})

describe('bounds', () => {
  it('reports the concrete limits of a caret range', () => {
    const result = bounds('^1.2.3')
    expect(result.min).toBe('1.2.3')
    expect(result.max).toBe('2.0.0')
    expect(result.maxStrict).toBe(true)
    expect(result.any).toBe(false)
  })

  it('flags a range that accepts anything', () => {
    expect(bounds('*').any).toBe(true)
    expect(bounds('>=1.0.0').max).toBeNull()
  })

  it('keeps an inclusive upper bound inclusive', () => {
    expect(bounds('1.2.3 - 2.0.0').maxStrict).toBe(false)
  })
})

describe('prerelease range matching', () => {
  // node-semver only lets a prerelease match a set that names one on the same
  // major.minor.patch. Without the rule ^1.0.0 would claim 2.0.0-beta.
  it('keeps a prerelease out of a range that does not name one', () => {
    expect(satisfies('2.0.0-beta', '^1.0.0')).toBe(false)
    expect(satisfies('1.5.0-beta', '^1.0.0')).toBe(false)
  })

  it('lets a range with its own prerelease match it', () => {
    expect(satisfies('1.0.0-beta.2', '>=1.0.0-beta.1 <1.0.0')).toBe(true)
    expect(satisfies('1.1.0-beta', '>=1.0.0-beta.1 <1.0.0')).toBe(false)
  })

  it('still matches a plain release against a caret range', () => {
    expect(satisfies('1.9.0', '^1.0.0')).toBe(true)
  })
})

describe('partial versions', () => {
  it('treats a partial version as its prefix, like npm does', () => {
    expect(satisfies('1.2.9', '1.2')).toBe(true)
    expect(satisfies('1.3.0', '1.2')).toBe(false)
    expect(satisfies('1.9.9', '1')).toBe(true)
  })

  it('handles caret and tilde on partial versions', () => {
    expect(satisfies('1.9.9', '^1')).toBe(true)
    expect(satisfies('2.0.0', '^1')).toBe(false)
    expect(satisfies('1.9.9', '~1')).toBe(true)
    expect(satisfies('2.0.0', '~1')).toBe(false)
  })

  it('rejects text that is not a version or range', () => {
    expect(() => satisfies('1.0.0', 'banana')).toThrow(SemverError)
  })
})

describe('boundaries', () => {
  it('compares long numeric prerelease identifiers without rounding', () => {
    // Number() would round both of these to the same float.
    expect(compareVersions('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBe(1)
    expect(compareVersions('1.0.0-alpha.9007199254740993', '1.0.0-alpha.9007199254740992')).toBe(1)
  })

  it('refuses a component too large to compare exactly', () => {
    expect(() => parse('90071992547409920.0.0')).toThrow(/too large/)
    expect(() => satisfies('1.0.0', '^90071992547409920.0.0')).toThrow(/too large/)
  })

  it('stays fast on a very large pasted range', () => {
    const huge = '>=1.0.0 '.repeat(400)
    const started = Date.now()
    expect(() => satisfies('1.0.0', huge)).toThrow(/too long/)
    expect(Date.now() - started).toBeLessThan(200)
  })

  it('handles zero and leading zeros', () => {
    expect(parse('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0, prerelease: [], build: [] })
    expect(satisfies('0.0.1', '>=0.0.0')).toBe(true)
  })
})

/**
 * Semantic Versioning parsing, comparison and range matching.
 *
 * Implements the parts of node-semver that matter day to day — `^`, `~`,
 * comparators, `x`/`*` wildcards, hyphen ranges and `||` unions — without a
 * dependency. Two details are easy to get wrong and are handled explicitly
 * here:
 *
 * - a range only matches a prerelease when a comparator in that same set
 *   names a prerelease on the same major/minor/patch, which is why
 *   `satisfies('2.0.0-beta', '^1.0.0')` is false;
 * - `x` wildcards are read from the text before it is parsed, because
 *   `parseLoose('1.2.x')` would otherwise turn the `x` into a zero and
 *   silently build the wrong comparator.
 */

export interface SemVer {
  major: number
  minor: number
  patch: number
  prerelease: string[]
  build: string[]
}

export class SemverError extends Error {}

const PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/

/**
 * Components above 2^53 lose precision as a float, which would make two
 * different versions compare equal. npm versions never get near this, so the
 * honest thing is to refuse rather than answer wrongly. The length cap also
 * bounds how much work a pasted string can ask of the regexes below.
 */
const MAX_LENGTH = 256

function toComponent(text: string): number {
  if (text.length > 16) {
    throw new SemverError(`The version part "${text}" is too large to compare exactly.`)
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value)) {
    throw new SemverError(`The version part "${text}" is too large to compare exactly.`)
  }
  return value
}

/** A version with zero or more numeric components filled in, for loose input. */
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/

export function parse(version: string): SemVer {
  const text = version.trim()
  if (text.length > MAX_LENGTH) throw new SemverError('That version is too long to read.')
  const match = PATTERN.exec(text)
  if (!match) throw new SemverError(`"${version}" is not a valid semantic version.`)
  return {
    major: toComponent(match[1]),
    minor: toComponent(match[2]),
    patch: toComponent(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  }
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      // Numeric identifiers are compared as numbers by the spec, but a float
      // would round two long identifiers together. Shorter means smaller, and
      // equal length can be compared as a string.
      if (x.length !== y.length) return x.length < y.length ? -1 : 1
      if (x !== y) return x < y ? -1 : 1
    } else if (xn) {
      return -1
    } else if (yn) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

export function compareVersions(a: string, b: string): number {
  return compare(parse(a), parse(b))
}

export function isStable(version: SemVer): boolean {
  return version.prerelease.length === 0
}

/** Render a version back to text, dropping empty components. */
export function format(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  const pre = version.prerelease.length ? `-${version.prerelease.join('.')}` : ''
  const build = version.build.length ? `+${version.build.join('.')}` : ''
  return `${core}${pre}${build}`
}

export interface Bump {
  label: string
  version: string
  /** What the bump means, in one clause. */
  hint: string
}

export function nextVersions(version: SemVer): Bump[] {
  const { major, minor, patch } = version
  return [
    { label: 'Patch', version: `${major}.${minor}.${patch + 1}`, hint: 'backwards-compatible fix' },
    { label: 'Minor', version: `${major}.${minor + 1}.0`, hint: 'backwards-compatible addition' },
    { label: 'Major', version: `${major + 1}.0.0`, hint: 'breaking change' },
  ]
}

/**
 * The version a range is anchored on — the first comparator that is not the
 * "any version" sentinel. Used to report which part of a range is what.
 */
export interface Comparator {
  operator: '>' | '>=' | '<' | '<=' | '='
  version: SemVer
}

interface ExpandedComparator extends Comparator {
  /** True when the text named a prerelease, which lets the set match one. */
  hasPrerelease: boolean
}

const ANY: ExpandedComparator = {
  operator: '>=',
  version: { major: 0, minor: 0, patch: 0, prerelease: [], build: [] },
  hasPrerelease: false,
}

function comparatorMatches(comparator: Comparator, version: SemVer): boolean {
  const diff = compare(version, comparator.version)
  switch (comparator.operator) {
    case '>':
      return diff > 0
    case '>=':
      return diff >= 0
    case '<':
      return diff < 0
    case '<=':
      return diff <= 0
    default:
      return diff === 0
  }
}

/** A parsed partial version: `x` components are recorded as null. */
interface Loose {
  major: number | null
  minor: number | null
  patch: number | null
  prerelease: string[]
  build: string[]
}

function parseLoose(version: string): Loose {
  const text = version.trim()
  if (text.length > MAX_LENGTH) throw new SemverError('That version is too long to read.')
  const match = PARTIAL.exec(text)
  if (!match) throw new SemverError(`"${version}" is not a version or range.`)
  const number = (part: string | undefined): number | null =>
    part === undefined || /^[xX*]$/.test(part) ? null : toComponent(part)
  return {
    major: number(match[1]),
    minor: number(match[2]),
    patch: number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  }
}

/** Fill a loose version's missing components with zero so it can be compared. */
function concrete(loose: Loose): SemVer {
  return {
    major: loose.major ?? 0,
    minor: loose.minor ?? 0,
    patch: loose.patch ?? 0,
    prerelease: loose.prerelease,
    build: loose.build,
  }
}

/** Expand one whitespace-separated comparator set into range comparators. */
function expand(token: string): ExpandedComparator[] {
  const text = token.trim()
  if (text === '' || text === '*' || text.toLowerCase() === 'x') return [ANY]

  // Hyphen range: "1.2.3 - 2.0.0".
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text)
  if (hyphen) {
    return [
      { operator: '>=', version: concrete(parseLoose(hyphen[1])), hasPrerelease: /-/.test(hyphen[1]) },
      { operator: '<=', version: concrete(parseLoose(hyphen[2])), hasPrerelease: /-/.test(hyphen[2]) },
    ]
  }

  const caret = /^\^(.+)$/.exec(text)
  if (caret) {
    const base = parseLoose(caret[1])
    if (base.major === null) return [ANY]
    const lower = concrete(base)
    // `^0.x` and `^0.0.x` are their own rules: a zero major makes every
    // minor bump breaking, and a zero minor makes every patch bump breaking.
    const upper = base.major > 0
      ? `${base.major + 1}.0.0`
      : base.minor === null
        ? '1.0.0'
        : base.minor > 0
          ? `0.${base.minor + 1}.0`
          : base.patch === null
            ? `0.1.0`
            : `0.0.${base.patch + 1}`
    return [
      { operator: '>=', version: lower, hasPrerelease: base.prerelease.length > 0 },
      { operator: '<', version: parse(upper), hasPrerelease: false },
    ]
  }

  const tilde = /^~(.+)$/.exec(text)
  if (tilde) {
    const base = parseLoose(tilde[1])
    if (base.major === null) return [ANY]
    const lower = concrete(base)
    const upper = base.minor === null ? `${base.major + 1}.0.0` : `${base.major}.${base.minor + 1}.0`
    return [
      { operator: '>=', version: lower, hasPrerelease: base.prerelease.length > 0 },
      { operator: '<', version: parse(upper), hasPrerelease: false },
    ]
  }

  const op = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(text)
  if (!op) throw new SemverError(`Cannot parse range "${text}".`)
  const loose = parseLoose(op[2])
  const wildcard = loose.major === null || loose.minor === null || loose.patch === null
  const bare = op[1] === undefined || op[1] === '='

  if (wildcard && bare) {
    // A wildcard means "any version in this prefix". The components come from
    // the text, not from a parse that would have turned the x into a zero.
    if (loose.major === null) return [ANY]
    if (loose.minor === null) {
      return [
        { operator: '>=', version: parse(`${loose.major}.0.0`), hasPrerelease: false },
        { operator: '<', version: parse(`${loose.major + 1}.0.0`), hasPrerelease: false },
      ]
    }
    return [
      { operator: '>=', version: parse(`${loose.major}.${loose.minor}.0`), hasPrerelease: false },
      { operator: '<', version: parse(`${loose.major}.${loose.minor + 1}.0`), hasPrerelease: false },
    ]
  }

  // A partial version with no wildcard still means the prefix: "1.2" is
  // "1.2.x" in npm. A bare comparator is the one place this applies, so a
  // range like "1.2" behaves the way package.json users expect.
  if (bare && (loose.minor === null || loose.patch === null)) {
    const major = loose.major ?? 0
    const minor = loose.minor ?? 0
    if (loose.minor === null) {
      return [
        { operator: '>=', version: parse(`${major}.0.0`), hasPrerelease: false },
        { operator: '<', version: parse(`${major + 1}.0.0`), hasPrerelease: false },
      ]
    }
    return [
      { operator: '>=', version: parse(`${major}.${minor}.0`), hasPrerelease: false },
      { operator: '<', version: parse(`${major}.${minor + 1}.0`), hasPrerelease: false },
    ]
  }

  return [{ operator: (op[1] as Comparator['operator']) ?? '=', version: concrete(loose), hasPrerelease: loose.prerelease.length > 0 }]
}

interface ComparatorSet {
  comparators: ExpandedComparator[]
  /** True when any comparator in the set named a prerelease. */
  hasPrerelease: boolean
}

function parseSet(text: string): ComparatorSet {
  const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(text)
  const comparators = hyphen ? expand(`${hyphen[1]} - ${hyphen[2]}`) : []
  if (!hyphen) {
    for (const token of text.trim().split(/\s+/).filter(Boolean)) comparators.push(...expand(token))
  }
  return { comparators, hasPrerelease: comparators.some((comparator) => comparator.hasPrerelease) }
}

/**
 * node-semver's prerelease rule: a version carrying a prerelease only matches
 * a set that names a prerelease on the same major/minor/patch. Without it
 * `^1.0.0` would quietly claim `2.0.0-beta` is compatible.
 */
function allowsPrerelease(set: ComparatorSet, version: SemVer): boolean {
  if (version.prerelease.length === 0) return true
  return set.comparators.some(
    (comparator) =>
      comparator.hasPrerelease &&
      comparator.version.major === version.major &&
      comparator.version.minor === version.minor &&
      comparator.version.patch === version.patch,
  )
}

/** Whether a version string satisfies a range string. */
export function satisfies(version: string, range: string): boolean {
  if (range.length > MAX_LENGTH) throw new SemverError('That range is too long to read.')
  const target = parse(version)
  for (const group of range.split('||')) {
    const set = parseSet(group)
    if (set.comparators.every((comparator) => comparatorMatches(comparator, target)) && allowsPrerelease(set, target)) {
      return true
    }
  }
  return false
}

/** Split a range into its `||` alternatives, trimmed, for display. */
export function rangeAlternatives(range: string): string[] {
  return range
    .split('||')
    .map((part) => part.trim())
    .filter(Boolean)
}

export interface Bounds {
  /** Lowest version the range accepts, when it has a lower bound. */
  min: string | null
  /** Highest version the range accepts, when it has an upper bound. */
  max: string | null
  /** True when the range accepts every version, e.g. `*`. */
  any: boolean
  /** True when the upper bound is exclusive, e.g. `<2.0.0`. */
  maxStrict: boolean
}

/**
 * The concrete bounds of one alternative of a range, ignoring prerelease
 * subtleties. It is the shape people want when they ask "what does `^1.2.3`
 * actually allow?".
 */
export function bounds(group: string): Bounds {
  if (group.length > MAX_LENGTH) throw new SemverError('That range is too long to read.')
  const set = parseSet(group)
  let min: SemVer | null = null
  let max: SemVer | null = null
  let maxStrict = false
  for (const comparator of set.comparators) {
    if (comparator === ANY) return { min: null, max: null, any: true, maxStrict: false }
    const upper = comparator.operator === '<' || comparator.operator === '<='
    if (upper) {
      if (max === null || compare(comparator.version, max) < 0) {
        max = comparator.version
        maxStrict = comparator.operator === '<'
      }
    } else if (min === null || compare(comparator.version, min) > 0) {
      min = comparator.version
    }
  }
  return {
    min: min ? format(min) : null,
    max: max ? format(max) : null,
    any: false,
    maxStrict,
  }
}

/** Explain a range in plain words, for the UI. */
export function describeRange(range: string): string {
  const trimmed = range.trim()
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'x') return 'Any version.'
  if (trimmed.includes('||')) return `Any of ${rangeAlternatives(trimmed).length} alternatives.`
  if (trimmed.startsWith('^')) return 'Compatible with the given version: no breaking change.'
  if (trimmed.startsWith('~')) return 'Patch-level changes to the given version only.'
  if (/\s-\s/.test(trimmed)) return 'Between two versions, inclusive.'
  if (/[xX*]/.test(trimmed)) return 'Any version matching the wildcard prefix.'
  return 'An exact version or a comparator match.'
}

/** The parts of a version, for a labelled breakdown in the UI. */
export function describeParts(version: SemVer): { label: string; value: string }[] {
  const parts = [
    { label: 'Major', value: String(version.major) },
    { label: 'Minor', value: String(version.minor) },
    { label: 'Patch', value: String(version.patch) },
  ]
  if (version.prerelease.length) parts.push({ label: 'Prerelease', value: version.prerelease.join('.') })
  if (version.build.length) parts.push({ label: 'Build metadata', value: version.build.join('.') })
  return parts
}

/** What a change between two versions means under Semantic Versioning. */
export function changeKind(from: SemVer, to: SemVer): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (compare(from, to) === 0) return { label: 'no change', tone: 'neutral' }
  if (from.major !== to.major) return { label: 'breaking change', tone: 'danger' }
  if (from.minor !== to.minor) {
    return from.major === 0
      ? { label: 'breaking (0.x minor)', tone: 'warn' }
      : { label: 'new feature', tone: 'ok' }
  }
  if (from.patch !== to.patch) return { label: 'fix', tone: 'ok' }
  if (from.prerelease.length > 0 && to.prerelease.length === 0) return { label: 'release', tone: 'ok' }
  return { label: 'prerelease change', tone: 'neutral' }
}

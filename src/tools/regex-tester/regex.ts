/** Regex running with indices, plus a plain-English pattern explainer. */

export interface MatchInfo {
  value: string
  index: number
  groups: (string | undefined)[]
  named: Record<string, string | undefined>
}

/** The flags the tester offers, with a plain-language meaning for each. */
export const FLAGS: { value: string; label: string; hint: string }[] = [
  { value: 'g', label: 'g', hint: 'global — find every match, not just the first' },
  { value: 'i', label: 'i', hint: 'ignore case' },
  { value: 'm', label: 'm', hint: 'multiline — ^ and $ match at line breaks' },
  { value: 's', label: 's', hint: 'dotall — . also matches newlines' },
  { value: 'u', label: 'u', hint: 'unicode — treat the pattern as full code points' },
  { value: 'y', label: 'y', hint: 'sticky — match only at lastIndex' },
]

/** Compile a pattern, returning a friendly error instead of throwing at the UI. */
export function compile(pattern: string, flags: string): { regex?: RegExp; error?: string } {
  try {
    // Always include `d` so we can report exact indices; avoid a duplicate flag.
    const unique = Array.from(new Set((flags + 'd').split(''))).join('')
    return { regex: new RegExp(pattern, unique) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Invalid regular expression' }
  }
}

export interface RunResult {
  matches: MatchInfo[]
  error?: string
  /** True when the match list was cut short at `limit`. */
  truncated?: boolean
}

export function runRegex(pattern: string, flags: string, input: string, limit = 500): RunResult {
  const { regex, error } = compile(pattern, flags)
  if (!regex) return { matches: [], error }

  const matches: MatchInfo[] = []
  if (!regex.global && !regex.sticky) {
    const match = regex.exec(input)
    if (match) matches.push(toInfo(match))
    return { matches }
  }

  let truncated = false
  let match: RegExpExecArray | null
  while ((match = regex.exec(input)) !== null) {
    if (matches.length >= limit) {
      truncated = true
      break
    }
    matches.push(toInfo(match))
    if (match[0] === '') regex.lastIndex++ // guard against zero-width loops
  }
  return { matches, truncated }
}

function toInfo(match: RegExpExecArray): MatchInfo {
  const indices = match.indices
  return {
    value: match[0],
    index: indices ? indices[0][0] : match.index,
    groups: match.slice(1),
    named: { ...(match.groups ?? {}) },
  }
}

export interface Explanation {
  token: string
  meaning: string
}

const CLASS_MEANINGS: Record<string, string> = {
  d: 'a digit (0–9)',
  D: 'anything but a digit',
  w: 'a word character (letter, digit or underscore)',
  W: 'anything but a word character',
  s: 'whitespace',
  S: 'anything but whitespace',
  b: 'a word boundary',
  B: 'not a word boundary',
  n: 'a newline',
  r: 'a carriage return',
  t: 'a tab',
  f: 'a form feed',
  v: 'a vertical tab',
  0: 'a NUL character',
}

const SINGLE_MEANINGS: Record<string, string> = {
  '^': 'start of the string (or line with the m flag)',
  $: 'end of the string (or line with the m flag)',
  '.': 'any character except newline (unless the s flag is set)',
  '|': 'OR',
  '*': 'repeat the previous token zero or more times',
  '+': 'repeat the previous token one or more times',
  '?': 'make the previous token optional',
}

/**
 * A deliberately readable breakdown of the most common constructs. It walks
 * the pattern one token at a time so nested groups, escapes inside character
 * classes and backreferences are described rather than swallowed.
 */
export function explain(pattern: string): Explanation[] {
  const out: Explanation[] = []
  const chars = [...pattern]
  let i = 0

  const push = (token: string, meaning: string) => out.push({ token, meaning })

  while (i < chars.length) {
    const char = chars[i]

    if (char === '\\') {
      const next = chars[i + 1] ?? ''
      // Escapes that consume more than one following character.
      if (next === 'k' && chars[i + 2] === '<') {
        const close = chars.indexOf('>', i + 3)
        const name = close < 0 ? '' : chars.slice(i + 3, close).join('')
        push(`\\k<${name}>`, `the text matched by the named group “${name}”`)
        i = close < 0 ? chars.length : close + 1
        continue
      }
      if ((next === 'p' || next === 'P') && chars[i + 2] === '{') {
        const close = chars.indexOf('}', i + 3)
        const name = close < 0 ? '' : chars.slice(i + 3, close).join('')
        push(`\\${next}{${name}}`, `${next === 'P' ? 'not ' : ''}a character in the Unicode property ${name}`)
        i = close < 0 ? chars.length : close + 1
        continue
      }
      if (next === 'x' && /^[0-9a-f]{2}$/i.test(chars.slice(i + 2, i + 4).join(''))) {
        const hex = chars.slice(i + 2, i + 4).join('')
        push(`\\x${hex}`, `the character with code U+00${hex.toUpperCase()}`)
        i += 4
        continue
      }
      if (next === 'u' && chars[i + 2] === '{') {
        const close = chars.indexOf('}', i + 3)
        const hex = close < 0 ? '' : chars.slice(i + 3, close).join('')
        push(`\\u{${hex}}`, `the character with code U+${hex.toUpperCase()}`)
        i = close < 0 ? chars.length : close + 1
        continue
      }
      if (next === 'u' && /^[0-9a-f]{4}$/i.test(chars.slice(i + 2, i + 6).join(''))) {
        const hex = chars.slice(i + 2, i + 6).join('')
        push(`\\u${hex}`, `the character with code U+${hex.toUpperCase()}`)
        i += 6
        continue
      }
      if (/[1-9]/.test(next)) {
        let digits = next
        let j = i + 2
        while (j < chars.length && /[0-9]/.test(chars[j]) && Number(digits + chars[j]) <= 99) {
          digits += chars[j]
          j++
        }
        push(`\\${digits}`, `the text matched by group ${digits}`)
        i = j
        continue
      }
      push(`\\${next}`, CLASS_MEANINGS[next] ?? `the literal “${next}”`)
      i += 2
      continue
    }

    if (char === '[') {
      let negated = false
      let inner = ''
      let j = i + 1
      if (chars[j] === '^') {
        negated = true
        j++
      }
      while (j < chars.length && chars[j] !== ']') {
        // A backslash inside a class escapes the next character, so `[\]]`
        // closes on the right bracket rather than at the escaped one.
        if (chars[j] === '\\' && j + 1 < chars.length) {
          inner += chars[j] + chars[j + 1]
          j += 2
          continue
        }
        inner += chars[j]
        j++
      }
      push(`[${negated ? '^' : ''}${inner}]`, `${negated ? 'not' : 'one of'} ${inner}`)
      i = j + 1
      continue
    }

    if (char === '(') {
      if (chars[i + 1] === '?') {
        const marker = chars[i + 2] ?? ''
        if (marker === ':') {
          push('(?:', 'start of a non-capturing group')
          i += 3
          continue
        }
        if (marker === '=') {
          push('(?=', 'start of a positive lookahead (must match ahead, but is not consumed)')
          i += 3
          continue
        }
        if (marker === '!') {
          push('(?!', 'start of a negative lookahead (must not match ahead)')
          i += 3
          continue
        }
        if (marker === '<' && chars[i + 3] === '=') {
          push('(?<=', 'start of a positive lookbehind (must match behind, but is not consumed)')
          i += 4
          continue
        }
        if (marker === '<' && chars[i + 3] === '!') {
          push('(?<!', 'start of a negative lookbehind (must not match behind)')
          i += 4
          continue
        }
        if (marker === '<') {
          const close = chars.indexOf('>', i + 3)
          const name = close < 0 ? '' : chars.slice(i + 3, close).join('')
          push(`(?<${name}>`, `start of the named group “${name}”`)
          i = close < 0 ? i + 3 : close + 1
          continue
        }
        // Unknown modifier: keep it verbatim so nothing is lost.
        push('(?', 'start of a special group')
        i += 2
        continue
      }
      push('(', 'start of a capturing group')
      i++
      continue
    }

    if (char === ')') {
      push(')', 'end of the group')
      i++
      continue
    }

    if (char === '{') {
      let inner = ''
      let j = i + 1
      while (j < chars.length && chars[j] !== '}') {
        inner += chars[j]
        j++
      }
      push(`{${inner}}`, describeRepeat(inner))
      i = j + 1
      continue
    }

    push(char, SINGLE_MEANINGS[char] ?? `the literal “${char}”`)
    i++
  }

  return out
}

function describeRepeat(inner: string): string {
  if (inner.includes(',')) {
    const [min, max] = inner.split(',')
    return max
      ? `repeat the previous token between ${min} and ${max} times`
      : `repeat the previous token at least ${min} times`
  }
  return `repeat the previous token exactly ${inner} times`
}

/**
 * Split the input into alternating matched and unmatched runs for the preview.
 * Zero-width matches are dropped here — they have no text to paint — but they
 * still appear in the match list.
 */
export function highlight(input: string, matches: MatchInfo[]): { text: string; match: boolean }[] {
  const segments: { text: string; match: boolean }[] = []
  let cursor = 0
  const spans = matches.filter((match) => match.value.length > 0).sort((a, b) => a.index - b.index)
  for (const match of spans) {
    if (match.index < cursor) continue
    if (match.index > cursor) segments.push({ text: input.slice(cursor, match.index), match: false })
    segments.push({ text: match.value, match: true })
    cursor = match.index + match.value.length
  }
  if (cursor < input.length) segments.push({ text: input.slice(cursor), match: false })
  return segments
}

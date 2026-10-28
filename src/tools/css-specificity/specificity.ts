/**
 * CSS selector specificity.
 *
 * Specificity is the familiar (ids, classes, elements) triple. A selector list
 * is split on top-level commas first, so a group like `a, b` is scored per part.
 *
 * The scanner is a small left-to-right tokeniser rather than a set of regexes:
 * the functional pseudos nest (`:is(.a, :not(#b))`), and a regex that only
 * understands one level of parentheses silently over-counts the inner parts.
 */

export interface Specificity {
  ids: number
  classes: number
  elements: number
}

export interface SelectorScore {
  selector: string
  specificity: Specificity
  important: boolean
}

/** A problem with the pasted selector list, phrased so it says how to fix it. */
export interface SelectorIssue {
  selector: string
  message: string
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a.ids - b.ids || a.classes - b.classes || a.elements - b.elements
}

export function formatSpecificity(s: Specificity): string {
  return `(${s.ids}, ${s.classes}, ${s.elements})`
}

/** A comparable key for a triple, e.g. `1-2-3`. */
export function specificityKey(s: Specificity): string {
  return `${s.ids}-${s.classes}-${s.elements}`
}

/**
 * Split a selector list on commas that are not inside brackets, parentheses or
 * quotes. Empty segments are dropped; `splitSelectorListRaw` keeps them so the
 * validator can see a stray trailing comma.
 */
export function splitSelectorList(input: string): string[] {
  return splitSelectorListRaw(input).filter((part) => part !== '')
}

export function splitSelectorListRaw(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (const char of input) {
    if (quote) {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current.trim())
  return parts
}

/** Pseudos that take the specificity of their most specific argument. */
const MAX_ARG_PSEUDOS = new Set(['not', 'is', 'has', 'matches', 'any', '-webkit-any', '-moz-any'])
/** Pseudos that contribute nothing at all. */
const ZERO_PSEUDOS = new Set(['where'])
/** Pseudo-elements whose argument adds its own specificity. */
const ARG_PSEUDO_ELEMENTS = new Set(['slotted', 'cue'])

const IDENT_CHAR = /[A-Za-z0-9_\-\u00A0-\uFFFF]/

function isIdentChar(char: string): boolean {
  return IDENT_CHAR.test(char)
}

/** End index of the identifier that starts at `start`, honouring `\` escapes. */
function readIdent(input: string, start: number): number {
  let i = start
  while (i < input.length) {
    if (input[i] === '\\') {
      // A hex escape is `\` + up to six hex digits, then one optional space
      // that terminates it and does not end the identifier (`#\31 23`).
      let j = i + 1
      let digits = 0
      while (j < input.length && digits < 6 && /[0-9a-fA-F]/.test(input[j])) {
        j++
        digits++
      }
      if (digits > 0) {
        if (j < input.length && /\s/.test(input[j])) j++
        i = j
        continue
      }
      i += 2
      continue
    }
    if (isIdentChar(input[i])) {
      i++
      continue
    }
    break
  }
  return i
}

/** Index just past the `)` that closes the `(` at `open`, or the string end. */
function matchParen(input: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < input.length; i++) {
    const char = input[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return input.length
}

/** Index just past the `]` that closes the `[` at `open`, or the string end. */
function matchBracket(input: string, open: number): number {
  let quote = ''
  for (let i = open; i < input.length; i++) {
    const char = input[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === ']') return i + 1
  }
  return input.length
}

/** The most specific triple in a selector list, or zero for an empty list. */
function maxOfList(selectorList: string): Specificity {
  let best: Specificity = { ids: 0, classes: 0, elements: 0 }
  for (const part of splitSelectorList(selectorList)) {
    const score: Specificity = { ids: 0, classes: 0, elements: 0 }
    countInto(part, score)
    if (compareSpecificity(score, best) > 0) best = score
  }
  return best
}

function add(target: Specificity, extra: Specificity): void {
  target.ids += extra.ids
  target.classes += extra.classes
  target.elements += extra.elements
}

/** Add the specificity of one complex selector into `result`. */
function countInto(selector: string, result: Specificity): void {
  let i = 0
  const text = selector

  while (i < text.length) {
    const char = text[i]

    if (char === '#' || char === '.') {
      const end = readIdent(text, i + 1)
      if (end > i + 1) {
        if (char === '#') result.ids++
        else result.classes++
        i = end
      } else {
        i++
      }
      continue
    }

    if (char === '[') {
      result.classes++
      i = matchBracket(text, i)
      continue
    }

    if (char === ':') {
      if (text[i + 1] === ':') {
        const end = readIdent(text, i + 2)
        const name = text.slice(i + 2, end).toLowerCase()
        result.elements++
        i = end
        if (text[i] === '(') {
          const close = matchParen(text, i)
          if (ARG_PSEUDO_ELEMENTS.has(name)) add(result, maxOfList(text.slice(i + 1, close - 1)))
          i = close
        }
        continue
      }

      const end = readIdent(text, i + 1)
      const name = text.slice(i + 1, end).toLowerCase()
      const hasArgs = text[end] === '('
      const close = hasArgs ? matchParen(text, end) : end
      const args = hasArgs ? text.slice(end + 1, close - 1) : ''

      if (ZERO_PSEUDOS.has(name)) {
        // :where() contributes nothing, arguments included.
      } else if (MAX_ARG_PSEUDOS.has(name)) {
        add(result, maxOfList(args))
      } else if (name === 'nth-child' || name === 'nth-last-child') {
        result.classes++
        // `:nth-child(2n+1 of .foo)` also takes its `of` selector's specificity.
        const ofIndex = args.toLowerCase().indexOf(' of ')
        if (ofIndex >= 0) add(result, maxOfList(args.slice(ofIndex + 4)))
      } else {
        result.classes++
      }
      i = close
      continue
    }

    if (isIdentChar(char)) {
      const end = readIdent(text, i)
      result.elements++
      i = end
      continue
    }

    // Combinators, whitespace, `*`, `&` and anything else add nothing.
    i++
  }
}

/** Compute the specificity of a single complex selector. */
export function specificityOf(selector: string, important = false): SelectorScore {
  let body = selector.trim()
  let importantFlag = important
  if (/!\s*important/i.test(body)) {
    importantFlag = true
    body = body.replace(/!\s*important/gi, '')
  }

  const result: Specificity = { ids: 0, classes: 0, elements: 0 }
  countInto(body, result)
  return { selector: selector.trim(), specificity: result, important: importantFlag }
}

export function scoreSelectorList(input: string): SelectorScore[] {
  return splitSelectorList(input).map((selector) => specificityOf(selector))
}

/**
 * Flag the pasted text that cannot be a selector, so the tool can say what is
 * wrong instead of quietly scoring nonsense.
 */
export function findIssues(input: string): SelectorIssue[] {
  const issues: SelectorIssue[] = []
  for (const part of splitSelectorListRaw(input)) {
    if (part === '') continue
    const label = part.length > 48 ? `${part.slice(0, 45)}…` : part
    if (/[{}]/.test(part)) {
      issues.push({
        selector: label,
        message: 'Looks like a CSS rule, not a selector — keep the part before the { … } block.',
      })
      continue
    }
    if (!balanced(part, '(', ')')) {
      issues.push({ selector: label, message: 'Unbalanced parentheses — add the missing “)”.' })
      continue
    }
    // Check quotes before brackets: an unclosed string makes bracket counting
    // unreliable, so it is the more useful thing to report.
    if (hasUnclosedQuote(part)) {
      issues.push({ selector: label, message: 'Unclosed quote in an attribute selector — close the string.' })
      continue
    }
    if (!balanced(part, '[', ']')) {
      issues.push({ selector: label, message: 'Unbalanced brackets — add the missing “]”.' })
    }
  }
  return issues
}

function balanced(input: string, open: string, close: string): boolean {
  let depth = 0
  let quote = ''
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === open) depth++
    else if (char === close) depth = Math.max(0, depth - 1)
  }
  return depth === 0
}

function hasUnclosedQuote(input: string): boolean {
  let quote = ''
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
  }
  return quote !== ''
}

export interface SelectorReport {
  scores: SelectorScore[]
  max: Specificity
  sorted: SelectorScore[]
  /** True when more than one selector shares the top score. */
  tiedTop: boolean
  issues: SelectorIssue[]
}

export function analyse(input: string): SelectorReport {
  const scores = scoreSelectorList(input)
  const max = scores.reduce<Specificity>(
    (best, score) => (compareSpecificity(score.specificity, best) > 0 ? score.specificity : best),
    { ids: 0, classes: 0, elements: 0 },
  )
  const sorted = [...scores].sort((a, b) => compareSpecificity(b.specificity, a.specificity))
  const tiedTop =
    scores.length > 1 && scores.filter((score) => compareSpecificity(score.specificity, max) === 0).length > 1
  return { scores, max, sorted, tiedTop, issues: findIssues(input) }
}

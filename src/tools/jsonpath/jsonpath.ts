/**
 * A focused JSONPath evaluator.
 *
 * Supported syntax:
 *   $                       root
 *   .name  ['name']         child (dot or bracket form); a quoted key may hold
 *                           any character, including dots and spaces
 *   .*     [*]              every child of an object or array
 *   ..name ..*              recursive descent
 *   [0]  [-1]               array index; negative counts from the end
 *   [0:3] [start:end:step]  array slice, Python semantics, negative step allowed
 *   [0,2,'a']               union of indices and names
 *   [?(expr)]               filter, e.g. [?(@.price > 10 && @.title =~ "Code")]
 *
 * Filters accept a small comparison grammar only — no arbitrary JavaScript —
 * so a path can never execute code from the input document. `&&`, `||`, `!`
 * and parentheses combine comparisons; a bare `@.name` tests that the key
 * exists.
 *
 * Traversal is iterative, depth-capped and match-capped, and reports
 * truncation rather than freezing the tab, so `$..*` over a multi-megabyte
 * document still answers.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface JsonPathMatch {
  path: string
  value: JsonValue
}

export class JsonPathError extends Error {}

/** Sentinel for "the key is not there", distinct from a JSON `null`. */
const MISSING = Symbol('missing')

/** Traversal guard rails. A document past these is answered partially, not hung. */
export const MAX_MATCHES = 20000
export const MAX_DEPTH = 512

export interface QueryOptions {
  /** Stop after this many matches. Defaults to `MAX_MATCHES`. */
  limit?: number
}

export interface QueryResult {
  matches: JsonPathMatch[]
  /** True when the match cap was hit, so the result is a prefix, not the answer. */
  truncated: boolean
}

type Segment =
  | { kind: 'child'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'recursive'; name?: string }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; slice: Slice }
  | { kind: 'union'; selectors: Segment[] }
  | { kind: 'filter'; source: string; test: (value: JsonValue) => boolean }

interface Slice {
  start?: number
  end?: number
  step: number
}

/* -------------------------------------------------------------------------
   Parsing
   ------------------------------------------------------------------------- */

const IDENT = /^[A-Za-z_$][\w$-]*/

/** Fail the parse, pointing at the character that broke it where we know it. */
function fail(message: string, position?: number): never {
  throw new JsonPathError(position === undefined ? message : `${message} (at position ${position})`)
}

function parsePath(path: string): Segment[] {
  const text = path.trim()
  if (text === '') throw new JsonPathError('Enter a path, for example $.store.book[0].title')
  if (!text.startsWith('$')) {
    throw new JsonPathError('A path must start with "$" — for example $.store.book[0].title')
  }
  const segments: Segment[] = []
  let i = 1

  while (i < text.length) {
    if (text.startsWith('..', i)) {
      i += 2
      const match = IDENT.exec(text.slice(i))
      if (match) {
        segments.push({ kind: 'recursive', name: match[0] })
        i += match[0].length
      } else if (text[i] === '*') {
        segments.push({ kind: 'recursive' })
        i += 1
      } else if (text[i] === '[') {
        segments.push({ kind: 'recursive' })
      } else {
        fail('Expected a name or "*" after ".."', i)
      }
      continue
    }

    if (text[i] === '.') {
      i += 1
      if (text[i] === '*') {
        segments.push({ kind: 'wildcard' })
        i += 1
        continue
      }
      const match = IDENT.exec(text.slice(i))
      if (!match) fail('Expected a property name', i)
      segments.push({ kind: 'child', name: match[0] })
      i += match[0].length
      continue
    }

    if (text[i] === '[') {
      const end = findBracketEnd(text, i)
      segments.push(parseBracket(text.slice(i + 1, end).trim(), i))
      i = end + 1
      continue
    }

    fail(`Unexpected character "${text[i]}"`, i)
  }

  return segments
}

function findBracketEnd(text: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[') depth += 1
    else if (char === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  throw new JsonPathError('Unclosed "[" in the path')
}

/** Split on top-level commas only, so `['a,b', 0]` stays two selectors. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]
    if (quote) {
      current += char
      if (char === '\\') {
        current += inner[i + 1] ?? ''
        i += 1
      } else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (char === '[' || char === '(') {
      depth += 1
      current += char
    } else if (char === ']' || char === ')') {
      depth -= 1
      current += char
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current.trim())
  return parts
}

function parseBracket(inner: string, position: number): Segment {
  if (inner === '') fail('Empty "[ ]" in the path', position)
  if (inner === '*') return { kind: 'wildcard' }

  if (inner.startsWith('?')) {
    const body = inner.replace(/^\?\s*/, '')
    const wrapped = /^\(\s*([\s\S]*)\s*\)$/.exec(body)
    const source = (wrapped ? wrapped[1] : body).trim()
    if (source === '') fail('A filter needs a condition, for example [?(@.price < 30)]', position)
    return { kind: 'filter', source, test: compileFilter(source) }
  }

  const parts = splitTopLevel(inner)
  if (parts.length > 1) return { kind: 'union', selectors: parts.map((part) => parseSelector(part, position)) }

  return parseSelector(inner, position)
}

function parseSelector(inner: string, position: number): Segment {
  if (inner === '*') return { kind: 'wildcard' }
  if (/^-?\d+$/.test(inner)) return { kind: 'index', index: Number(inner) }

  if (inner.includes(':')) {
    const pieces = inner.split(':')
    if (pieces.length > 3) fail(`A slice takes at most three parts, got "${inner}"`, position)
    const [startText, endText, stepText] = pieces
    const start = startText.trim() === '' ? undefined : Number(startText)
    const end = endText === undefined || endText.trim() === '' ? undefined : Number(endText)
    const step = stepText === undefined || stepText.trim() === '' ? 1 : Number(stepText)
    if (!Number.isInteger(step)) fail('A slice step must be a whole number', position)
    if (step === 0) fail('A slice step cannot be zero', position)
    if ((start !== undefined && !Number.isInteger(start)) || (end !== undefined && !Number.isInteger(end))) {
      fail('Slice bounds must be whole numbers', position)
    }
    return { kind: 'slice', slice: { start, end, step } }
  }

  const quoted = /^(['"])([\s\S]*)\1$/.exec(inner)
  if (quoted) return { kind: 'child', name: unescape(quoted[2]) }

  fail(`Cannot read "[${inner}]" — use an index, a quoted name, a slice, a union or a filter`, position)
}

/* -------------------------------------------------------------------------
   Filters
   ------------------------------------------------------------------------- */

type Operand = { kind: 'node'; path: string[] } | { kind: 'literal'; value: JsonValue }
type Predicate = (value: JsonValue) => boolean

interface Cursor {
  text: string
  pos: number
}

const COMPARATORS = ['==', '!=', '<=', '>=', '=~', '<', '>', '='] as const

function compileFilter(source: string): Predicate {
  const cursor: Cursor = { text: source, pos: 0 }
  const predicate = parseOr(cursor)
  skipSpace(cursor)
  if (cursor.pos < cursor.text.length) {
    fail(`Unexpected "${cursor.text.slice(cursor.pos)}" in the filter`, cursor.pos)
  }
  return predicate
}

function skipSpace(cursor: Cursor): void {
  while (cursor.pos < cursor.text.length && /\s/.test(cursor.text[cursor.pos])) cursor.pos += 1
}

function eat(cursor: Cursor, token: string): boolean {
  skipSpace(cursor)
  if (cursor.text.startsWith(token, cursor.pos)) {
    cursor.pos += token.length
    return true
  }
  return false
}

function parseOr(cursor: Cursor): Predicate {
  let left = parseAnd(cursor)
  while (eat(cursor, '||')) {
    const right = parseAnd(cursor)
    const previous = left
    left = (value) => previous(value) || right(value)
  }
  return left
}

function parseAnd(cursor: Cursor): Predicate {
  let left = parseUnary(cursor)
  while (eat(cursor, '&&')) {
    const right = parseUnary(cursor)
    const previous = left
    left = (value) => previous(value) && right(value)
  }
  return left
}

function parseUnary(cursor: Cursor): Predicate {
  skipSpace(cursor)
  if (eat(cursor, '!')) {
    if (eat(cursor, '=')) fail('Use "!=" for "not equal"', cursor.pos - 1)
    const inner = parseUnary(cursor)
    return (value) => !inner(value)
  }
  if (cursor.text[cursor.pos] === '(') {
    cursor.pos += 1
    const inner = parseOr(cursor)
    skipSpace(cursor)
    if (cursor.text[cursor.pos] !== ')') fail('Missing ")" in the filter', cursor.pos)
    cursor.pos += 1
    return inner
  }
  return parseComparison(cursor)
}

function parseComparison(cursor: Cursor): Predicate {
  const left = parseOperand(cursor)
  skipSpace(cursor)
  const operator = COMPARATORS.find((candidate) => cursor.text.startsWith(candidate, cursor.pos))
  if (!operator) {
    if (left.kind === 'literal') fail('A filter condition needs a comparison, for example @.price < 30')
    // A bare `@.name` is an existence test.
    return (value) => readOperand(left, value) !== MISSING
  }
  cursor.pos += operator.length
  return compare(left, operator, parseOperand(cursor))
}

function parseOperand(cursor: Cursor): Operand {
  skipSpace(cursor)
  if (cursor.text[cursor.pos] === '@') {
    cursor.pos += 1
    const path: string[] = []
    // `@.a.b` and `@['a.b']` both address nested keys.
    while (cursor.pos < cursor.text.length) {
      if (cursor.text[cursor.pos] === '.') {
        const match = IDENT.exec(cursor.text.slice(cursor.pos + 1))
        if (!match) fail('Expected a property name after "." in the filter', cursor.pos)
        path.push(match[0])
        cursor.pos += 1 + match[0].length
        continue
      }
      if (cursor.text[cursor.pos] === '[') {
        const end = findBracketEnd(cursor.text, cursor.pos)
        const inner = cursor.text.slice(cursor.pos + 1, end).trim()
        const quoted = /^(['"])([\s\S]*)\1$/.exec(inner)
        if (quoted) path.push(unescape(quoted[2]))
        else if (/^-?\d+$/.test(inner)) path.push(inner)
        else fail(`Only names and indices are allowed in a filter path, got "[${inner}]"`, cursor.pos)
        cursor.pos = end + 1
        continue
      }
      break
    }
    return { kind: 'node', path }
  }
  return { kind: 'literal', value: parseLiteral(cursor) }
}

function parseLiteral(cursor: Cursor): JsonValue {
  skipSpace(cursor)
  const rest = cursor.text.slice(cursor.pos)
  const quoted = /^(['"])((?:\\[\s\S]|[^\\])*)\1/.exec(rest)
  if (quoted) {
    cursor.pos += quoted[0].length
    return unescape(quoted[2])
  }
  if (rest[0] === '[' || rest[0] === '{') {
    const end = findClosing(rest, rest[0])
    const inner = rest.slice(1, end).trim()
    cursor.pos += end + 1
    if (rest[0] === '[') {
      if (inner === '') return []
      return splitTopLevel(inner).map((part) => parseLiteralValue(part))
    }
    if (inner === '') return {}
    const out: { [key: string]: JsonValue } = {}
    for (const part of splitTopLevel(inner)) {
      const colon = part.indexOf(':')
      if (colon < 0) fail(`Expected "key: value" in the filter object literal, got "${part}"`, cursor.pos)
      const key = part.slice(0, colon).trim().replace(/^(['"])|(['"])$/g, '')
      out[key] = parseLiteralValue(part.slice(colon + 1).trim())
    }
    return out
  }
  const number = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(rest)
  if (number) {
    cursor.pos += number[0].length
    return Number(number[0])
  }
  for (const [word, value] of [['true', true], ['false', false], ['null', null]] as const) {
    if (rest.startsWith(word)) {
      cursor.pos += word.length
      return value
    }
  }
  fail(`Cannot read the value "${rest.trim() || 'end of filter'}" in the filter`, cursor.pos)
}

/** End index of the literal `[`/`{` that opens `text[0]`, respecting quotes. */
function findClosing(text: string, open: string): number {
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  fail('Unclosed literal in the filter')
}

/** Parse a standalone literal, used for array and object literal members. */
function parseLiteralValue(text: string): JsonValue {
  const cursor: Cursor = { text, pos: 0 }
  const value = parseLiteral(cursor)
  skipSpace(cursor)
  if (cursor.pos < text.length) fail(`Unexpected "${text.slice(cursor.pos)}" in the filter literal`, cursor.pos)
  return value
}

function unescape(text: string): string {
  return text.replace(/\\([\s\S])/g, (_, char: string) => {
    if (char === 'n') return '\n'
    if (char === 't') return '\t'
    if (char === 'r') return '\r'
    return char
  })
}

function readOperand(operand: Operand, value: JsonValue): JsonValue | typeof MISSING {
  if (operand.kind === 'literal') return operand.value
  let node: JsonValue = value
  for (const part of operand.path) {
    if (Array.isArray(node)) {
      if (!/^-?\d+$/.test(part)) return MISSING
      const index = Number(part) < 0 ? node.length + Number(part) : Number(part)
      if (index < 0 || index >= node.length) return MISSING
      node = node[index]
      continue
    }
    if (node !== null && typeof node === 'object' && part in node) {
      node = (node as Record<string, JsonValue>)[part]
      continue
    }
    return MISSING
  }
  return node
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, JsonValue>
    const right = b as Record<string, JsonValue>
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length && keys.every((key) => key in right && deepEqual(left[key], right[key]))
  }
  return false
}

function compare(left: Operand, operator: string, right: Operand): Predicate {
  // A pattern is compiled once, at parse time, so a bad one is a path error
  // rather than a crash halfway through a traversal.
  let pattern: RegExp | null = null
  if (operator === '=~') {
    if (right.kind !== 'literal' || typeof right.value !== 'string') {
      fail('The right side of "=~" must be a quoted pattern, for example @.title =~ "^Clean"')
    }
    try {
      pattern = new RegExp(right.value)
    } catch (error) {
      fail(`That is not a valid pattern: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (value) => {
    const a = readOperand(left, value)
    if (a === MISSING) return false
    const b = readOperand(right, value)
    if (b === MISSING) return false
    switch (operator) {
      case '==':
      case '=':
        return deepEqual(a, b)
      case '!=':
        return !deepEqual(a, b)
      case '=~':
        return typeof a === 'string' && pattern !== null && pattern.test(a)
      case '<':
      case '<=':
      case '>':
      case '>=': {
        // Ordered comparison only between two numbers or two strings, which is
        // what "10" vs 9 surprises people with in looser implementations.
        const ordered = typeof a === 'number' && typeof b === 'number' ? [a, b] : typeof a === 'string' && typeof b === 'string' ? [a, b] : null
        if (!ordered) return false
        const [x, y] = ordered
        if (operator === '<') return x < y
        if (operator === '<=') return x <= y
        if (operator === '>') return x > y
        return x >= y
      }
      default:
        return false
    }
  }
}

/* -------------------------------------------------------------------------
   Traversal
   ------------------------------------------------------------------------- */

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SIMPLE_KEY = /^[A-Za-z_$][\w$]*$/

function join(prefix: string, key: string | number): string {
  if (typeof key === 'number') return `${prefix}[${key}]`
  if (SIMPLE_KEY.test(key)) return `${prefix}.${key}`
  return `${prefix}['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
}

function children(value: JsonValue): [string | number, JsonValue][] {
  if (Array.isArray(value)) return value.map((child, index) => [index, child] as [number, JsonValue])
  if (isObject(value)) return Object.entries(value)
  return []
}

/** Every index a `[start:end:step]` selects, with Python's clamping rules. */
export function sliceIndices(length: number, slice: Slice): number[] {
  const { step } = slice
  const indices: number[] = []
  if (step > 0) {
    const from = slice.start === undefined ? 0 : slice.start < 0 ? Math.max(length + slice.start, 0) : Math.min(slice.start, length)
    const to = slice.end === undefined ? length : slice.end < 0 ? Math.max(length + slice.end, 0) : Math.min(slice.end, length)
    for (let i = from; i < to; i += step) indices.push(i)
    return indices
  }
  const rawFrom = slice.start === undefined ? length - 1 : slice.start < 0 ? length + slice.start : slice.start
  const from = Math.min(rawFrom, length - 1)
  const rawTo = slice.end === undefined ? -1 : slice.end < 0 ? length + slice.end : slice.end
  const to = Math.max(Math.min(rawTo, length - 1), -1)
  for (let i = from; i > to; i += step) indices.push(i)
  return indices
}

/**
 * Descendants of `value` in document order, matching `name` when given.
 * Iterative with an explicit stack: a deeply nested document cannot blow the
 * call stack the way a recursive walk does.
 */
function descend(value: JsonValue, name: string | undefined, prefix: string, out: JsonPathMatch[], limit: number): void {
  const stack: { value: JsonValue; prefix: string; depth: number }[] = [{ value, prefix, depth: 0 }]
  while (stack.length > 0 && out.length < limit) {
    const node = stack.pop()!
    if (node.depth >= MAX_DEPTH) continue
    const entries = children(node.value)
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, child] = entries[i]
      const path = join(node.prefix, key)
      if (name === undefined || String(key) === name) out.push({ path, value: child })
      stack.push({ value: child, prefix: path, depth: node.depth + 1 })
    }
  }
}

function applySegment(nodes: JsonPathMatch[], segment: Segment, limit: number): JsonPathMatch[] {
  const out: JsonPathMatch[] = []
  const push = (match: JsonPathMatch): boolean => {
    out.push(match)
    return out.length < limit
  }

  for (const node of nodes) {
    if (out.length >= limit) break
    const value = node.value
    switch (segment.kind) {
      case 'child':
        if (isObject(value) && segment.name in value) push({ path: join(node.path, segment.name), value: value[segment.name] })
        break
      case 'wildcard':
        for (const [key, child] of children(value)) {
          if (!push({ path: join(node.path, key), value: child })) break
        }
        break
      case 'recursive':
        descend(value, segment.name, node.path, out, limit)
        break
      case 'index': {
        if (!Array.isArray(value)) break
        const index = segment.index < 0 ? value.length + segment.index : segment.index
        if (index >= 0 && index < value.length) push({ path: join(node.path, index), value: value[index] })
        break
      }
      case 'slice': {
        if (!Array.isArray(value)) break
        for (const index of sliceIndices(value.length, segment.slice)) {
          if (!push({ path: join(node.path, index), value: value[index] })) break
        }
        break
      }
      case 'union':
        for (const selector of segment.selectors) {
          out.push(...applySegment([node], selector, Math.max(0, limit - out.length)))
          if (out.length >= limit) break
        }
        break
      case 'filter':
        for (const [key, child] of children(value)) {
          let matches = false
          try {
            matches = segment.test(child)
          } catch {
            // A predicate that throws (a runaway pattern) simply does not match.
            matches = false
          }
          if (matches && !push({ path: join(node.path, key), value: child })) break
        }
        break
    }
  }
  return out
}

/** Evaluate a path and report whether the match cap cut the answer short. */
export function runQuery(document: JsonValue, path: string, options: QueryOptions = {}): QueryResult {
  const limit = Math.max(1, options.limit ?? MAX_MATCHES)
  const segments = parsePath(path)
  let nodes: JsonPathMatch[] = [{ path: '$', value: document }]
  let truncated = false
  for (const segment of segments) {
    nodes = applySegment(nodes, segment, limit + 1)
    if (nodes.length > limit) {
      nodes = nodes.slice(0, limit)
      truncated = true
      break
    }
  }
  return { matches: nodes, truncated }
}

/** Evaluate a JSONPath against a document, returning every match. */
export function query(document: JsonValue, path: string, options: QueryOptions = {}): JsonPathMatch[] {
  return runQuery(document, path, options).matches
}

/* -------------------------------------------------------------------------
   Presentation helpers (pure, so the UI stays a paint layer)
   ------------------------------------------------------------------------- */

/** Pretty-print one matched value the way it would appear in a JSON file. */
export function stringifyValue(value: JsonValue): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

/** How many characters a match is worth showing before it is elided. */
const PREVIEW_LIMIT = 240

/** A single-line preview, so one huge match cannot blow up the result list. */
export function previewValue(value: JsonValue): string {
  const text = JSON.stringify(value) ?? 'null'
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text
}

/** A plain-language reading of each step of a path, for the query hint. */
export function explainPath(path: string): string[] {
  return parsePath(path).map((segment) => {
    switch (segment.kind) {
      case 'child':
        return `child "${segment.name}"`
      case 'wildcard':
        return 'every child'
      case 'recursive':
        return segment.name === undefined ? 'every descendant' : `any descendant named "${segment.name}"`
      case 'index':
        return segment.index < 0 ? `index ${segment.index} (from the end)` : `index ${segment.index}`
      case 'slice': {
        const { start, end, step } = segment.slice
        const parts = [start ?? '', end ?? '']
        if (step !== 1) parts.push(String(step))
        return `slice [${parts.join(':')}]`
      }
      case 'union':
        return `one of ${segment.selectors
          .map((selector) => (selector.kind === 'child' ? `"${selector.name}"` : selector.kind === 'index' ? String(selector.index) : 'a range'))
          .join(', ')}`
      case 'filter':
        return `filter ${segment.source}`
    }
  })
}

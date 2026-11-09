/** Percent-encoding helpers and query-string parsing/building. */

export interface QueryParam {
  key: string
  value: string
}

export function encodeComponent(text: string): string {
  return encodeURIComponent(text)
}

export function decodeComponent(text: string): string {
  return decodeURIComponent(text)
}

/**
 * Decode every valid percent sequence in a string, leaving any malformed one
 * (`%zz`, a lone `%`, a truncated multi-byte run) exactly as written.
 *
 * A naive per-token `decodeURIComponent` cannot do this: `%C3` on its own is an
 * incomplete UTF-8 lead byte and throws, so the old code left the whole of
 * `%C3%A9` (é) undecoded. Decoding each run of consecutive sequences at once —
 * and falling back to one sequence at a time only when the run is malformed —
 * recovers multi-byte characters without ever throwing.
 */
export function safeDecode(text: string, plusAsSpace = true): string {
  const source = plusAsSpace ? text.replace(/\+/g, ' ') : text
  return source.replace(/(?:%[0-9a-fA-F]{2})+|[^%]+|%/g, (run) => {
    if (run.charCodeAt(0) !== 37 /* % */) return run
    try {
      return decodeURIComponent(run)
    } catch {
      return run.replace(/%[0-9a-fA-F]{2}/g, (token) => {
        try {
          return decodeURIComponent(token)
        } catch {
          return token
        }
      })
    }
  })
}

/** Percent-encode a whole URL, keeping the structure (`:/?#[]@`) intact. */
export function encodeUrl(text: string): string {
  return encodeURI(text)
}

/** Decode a whole URL, tolerating a malformed percent sequence. */
export function decodeUrl(text: string): string {
  return safeDecode(text, false)
}

export interface ParsedUrl {
  base: string
  params: QueryParam[]
  hash: string
}

/**
 * Split an arbitrary URL-or-path into base, ordered params and hash. Repeated
 * keys are preserved; blank keys are ignored.
 */
export function parseUrl(input: string): ParsedUrl {
  const hashAt = input.indexOf('#')
  const hash = hashAt >= 0 ? input.slice(hashAt + 1) : ''
  const rest = hashAt >= 0 ? input.slice(0, hashAt) : input

  const queryAt = rest.indexOf('?')
  const base = queryAt >= 0 ? rest.slice(0, queryAt) : rest
  const query = queryAt >= 0 ? rest.slice(queryAt + 1) : ''

  const params: QueryParam[] = []
  if (query) {
    for (const pair of query.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const rawKey = eq >= 0 ? pair.slice(0, eq) : pair
      const rawValue = eq >= 0 ? pair.slice(eq + 1) : ''
      const key = safeDecode(rawKey)
      if (!key) continue
      params.push({ key, value: safeDecode(rawValue) })
    }
  }

  return { base, params, hash }
}

export interface BuildOptions {
  /** Encode parameter names and values (spaces become `%20`). */
  encode: boolean
  /** Encode the base (scheme, path, spaces) and the hash. */
  encodeBase?: boolean
  /** Encode spaces in the query as `+` (form style) instead of `%20`. */
  formSpaces?: boolean
  sort: boolean
}

/**
 * Form-style query encoding: `encodeURIComponent`, then spaces as `+` and the
 * extra characters `URLSearchParams` percent-encodes for an
 * `application/x-www-form-urlencoded` body (`!`, `'`, `(`, `)`, `~`).
 */
export function formEncode(text: string): string {
  return encodeURIComponent(text)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function encodeValue(text: string, options: BuildOptions): string {
  if (!options.encode) return text
  return options.formSpaces ? formEncode(text) : encodeURIComponent(text)
}

export function buildUrl(base: string, params: QueryParam[], hash: string, options: BuildOptions): string {
  let list = params.filter((p) => p.key.trim().length > 0)
  if (options.sort) list = [...list].sort((a, b) => a.key.localeCompare(b.key))

  const query = list
    .map((p) => {
      const key = encodeValue(p.key, options)
      const value = encodeValue(p.value, options)
      return value ? `${key}=${value}` : key
    })
    .join('&')

  // The base is a whole URL, so `encodeURI` (which keeps `:/?#[]@` and friends)
  // is the right encoder: it fixes a pasted space or `"` without breaking the
  // structure. The hash is encoded more aggressively because it is a fragment.
  const outBase = options.encodeBase ? encodeURI(base) : base
  const outHash = options.encodeBase && hash ? encodeURIComponent(hash) : hash

  let result = outBase
  if (query) result += `?${query}`
  if (outHash) result += `#${outHash}`
  return result
}

export interface DuplicateGroup {
  key: string
  /** Zero-based positions of every occurrence in the parameter list. */
  indices: number[]
}

/**
 * Keys that appear more than once. Repeated keys are legal (`?a=1&a=2`) and are
 * kept, but many servers read only the first or last, so the tool surfaces the
 * ambiguity rather than silently dropping a value.
 */
export function duplicateKeys(params: QueryParam[]): DuplicateGroup[] {
  const seen = new Map<string, number[]>()
  params.forEach((param, index) => {
    const list = seen.get(param.key)
    if (list) list.push(index)
    else seen.set(param.key, [index])
  })
  const groups: DuplicateGroup[] = []
  for (const [key, indices] of seen) {
    if (indices.length > 1) groups.push({ key, indices })
  }
  return groups
}

export interface UrlParts {
  scheme: string
  /** Userinfo, host and port, e.g. `user@example.com:8080`. */
  authority: string
  path: string
  query: string
  hash: string
}

/**
 * A best-effort split of a URL into the five components a person recognises.
 * It never throws — a bare path or a relative URL simply has empty pieces.
 */
export function urlParts(input: string): UrlParts {
  const hashAt = input.indexOf('#')
  const hash = hashAt >= 0 ? input.slice(hashAt + 1) : ''
  const beforeHash = hashAt >= 0 ? input.slice(0, hashAt) : input

  const queryAt = beforeHash.indexOf('?')
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : ''
  const beforeQuery = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(beforeQuery)
  const scheme = schemeMatch ? schemeMatch[1] : ''
  const afterScheme = schemeMatch ? beforeQuery.slice(schemeMatch[0].length) : beforeQuery

  let authority = ''
  let path = afterScheme
  if (afterScheme.startsWith('//')) {
    const rest = afterScheme.slice(2)
    const slashAt = rest.indexOf('/')
    authority = slashAt >= 0 ? rest.slice(0, slashAt) : rest
    path = slashAt >= 0 ? rest.slice(slashAt) : ''
  }

  return { scheme, authority, path, query, hash }
}

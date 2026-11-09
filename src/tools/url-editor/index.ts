import {
  actions,
  button,
  checkbox,
  chips,
  copyRow,
  field,
  iconButton,
  kvList,
  note,
  outputBlock,
  panel,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  buildUrl,
  decodeUrl,
  duplicateKeys,
  encodeUrl,
  parseUrl,
  urlParts,
  type QueryParam,
} from './url'

const EXAMPLES: { label: string; value: string }[] = [
  { label: 'Unicode search', value: 'https://shop.example.com/search?q=caf%C3%A9&page=2#results' },
  { label: 'Repeated key', value: 'https://api.example.com/items?tag=js&tag=css&sort=asc' },
  { label: 'Space to fix', value: 'https://example.com/a b?q=hello world' },
]

/** Render at most this many parameter rows; the rest are counted, not drawn. */
const MAX_ROWS = 1000

const tool: Tool = {
  slug: 'url-editor',
  name: 'URL & Query String Editor',
  description: 'Decode, edit and rebuild URLs with a table of query parameters.',
  category: 'Data',
  keywords: ['url', 'query string', 'percent encoding', 'uri', 'params', 'decode', 'encode', 'query params'],
  render(root) {
    const input = textarea({ rows: 3, placeholder: 'https://example.com/path?a=1&b=2#top', onInput: () => parseInput() })
    input.id = 'ts-url-input'
    input.setAttribute('autocomplete', 'off')

    let parsed = { base: '', params: [] as QueryParam[], hash: '' }
    let encode = true
    let encodeBase = false
    let formSpaces = false
    let sort = false

    const paramList = el('div', { class: 'ts-param-list' })
    const paramHint = el('p', { class: 'ts-k-hint' })
    const duplicateNotice = note('', 'warn')
    duplicateNotice.hidden = true
    duplicateNotice.setAttribute('role', 'status')

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    const built = outputBlock('', { label: 'Rebuilt URL', copy: () => built.body.textContent ?? '' })
    const parts = kvList()
    const codec = kvList()

    // One concise sentence for screen readers; the visible output stays silent
    // so a keystroke is not announced twice.
    const status = el('p', { class: 'ts-url-sr', role: 'status', 'aria-live': 'polite' })

    function options() {
      return { encode, encodeBase, formSpaces, sort }
    }

    function rebuild() {
      const value = buildUrl(parsed.base, parsed.params, parsed.hash, options())
      built.body.replaceChildren(value || '—')
      const count = parsed.params.filter((p) => p.key.trim()).length
      built.setMeta(
        value
          ? `${count} param${count === 1 ? '' : 's'}`
          : 'Paste a URL above to build one',
      )
    }

    function paramRow(param: QueryParam, index: number) {
      const position = index + 1
      const key = el('input', {
        class: 'ts-k-input ts-k-mono',
        value: param.key,
        'aria-label': `Parameter ${position} name`,
        autocomplete: 'off',
      }) as HTMLInputElement
      const value = el('input', {
        class: 'ts-k-input ts-k-mono',
        value: param.value,
        'aria-label': `Parameter ${position} value`,
        autocomplete: 'off',
      }) as HTMLInputElement
      key.addEventListener('input', () => {
        parsed.params[index].key = key.value
        refresh({ rebuildRows: false })
      })
      value.addEventListener('input', () => {
        parsed.params[index].value = value.value
        refresh({ rebuildRows: false })
      })
      return el(
        'div',
        { class: 'ts-param-row' },
        key,
        value,
        iconButton('close', {
          label: `Remove parameter ${position}`,
          size: 'sm',
          variant: 'ghost',
          onClick: () => {
            parsed.params.splice(index, 1)
            renderParams()
            refresh()
          },
        }),
      )
    }

    function renderParams() {
      const visible = parsed.params.slice(0, MAX_ROWS)
      paramList.replaceChildren(...visible.map(paramRow))
      if (parsed.params.length === 0) {
        paramList.append(el('p', { class: 'ts-k-hint ts-url-empty' }, 'No query parameters yet. Add one below, or paste a URL that already has some.'))
      } else if (parsed.params.length > MAX_ROWS) {
        paramList.append(
          el('p', { class: 'ts-k-hint' }, `Showing the first ${MAX_ROWS} of ${parsed.params.length} parameters.`),
        )
      }
    }

    function renderDuplicates() {
      const groups = duplicateKeys(parsed.params)
      if (groups.length === 0) {
        duplicateNotice.hidden = true
        return
      }
      const names = groups.map((g) => `“${g.key}” (×${g.indices.length})`).join(', ')
      duplicateNotice.textContent = `Repeated ${groups.length === 1 ? 'key' : 'keys'}: ${names}. Repeated keys are kept, but most servers read only the first or the last value.`
      duplicateNotice.hidden = false
    }

    function renderParts() {
      if (!input.value) {
        parts.replaceChildren(
          copyRow('Scheme', '—', { copy: false }),
          copyRow('Host', '—', { copy: false }),
          copyRow('Path', '—', { copy: false }),
          copyRow('Query', '—', { copy: false }),
          copyRow('Fragment', '—', { copy: false }),
        )
        return
      }
      const p = urlParts(input.value)
      const blank = (value: string) => value || '—'
      parts.replaceChildren(
        copyRow('Scheme', blank(p.scheme), { copy: p.scheme !== '' }),
        copyRow('Host', blank(p.authority), { copy: p.authority !== '' }),
        copyRow('Path', blank(p.path), { copy: p.path !== '' }),
        copyRow('Query', blank(p.query), { copy: p.query !== '' }),
        copyRow('Fragment', blank(p.hash), { copy: p.hash !== '' }),
      )
    }

    function renderCodec() {
      if (!input.value) {
        codec.replaceChildren(copyRow('Encoded', '—', { copy: false }), copyRow('Decoded', '—', { copy: false }))
        return
      }
      codec.replaceChildren(
        copyRow('Encoded (whole URL)', encodeUrl(input.value)),
        copyRow('Decoded', decodeUrl(input.value)),
      )
    }

    function refresh(opts: { rebuildRows?: boolean } = {}) {
      if (opts.rebuildRows) renderParams()
      renderDuplicates()
      renderParts()
      renderCodec()
      rebuild()
    }

    function parseInput() {
      try {
        parsed = parseUrl(input.value)
        error.hidden = true
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : 'Could not parse this URL.'
        error.hidden = false
      }
      renderParams()
      refresh()
      const count = parsed.params.length
      status.textContent = input.value
        ? `Parsed ${count} parameter${count === 1 ? '' : 's'}.`
        : 'Waiting for a URL.'
    }

    const exampleRow = chips(
      EXAMPLES.map((example) => ({
        label: example.label,
        title: `Load: ${example.value}`,
        onClick: () => {
          input.value = example.value
          parseInput()
          input.focus()
        },
      })),
    )

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'URL', icon: 'globe' },
          field(input, { label: 'URL or path', forId: 'ts-url-input', hint: 'A full URL, a path, or just a query string.' }),
          actions(el('span', { class: 'ts-url-examples-label' }, 'Examples:'), exampleRow),
          error,
        ),
        panel(
          { title: 'Query parameters', icon: 'sliders' },
          duplicateNotice,
          paramList,
          paramHint,
          actions(
            button('Add parameter', {
              icon: 'plus',
              size: 'sm',
              onClick: () => {
                parsed.params.push({ key: '', value: '' })
                renderParams()
                refresh()
                const inputs = paramList.querySelectorAll('input')
                const last = inputs[inputs.length - 2] as HTMLInputElement | undefined
                last?.focus()
              },
            }),
          ),
          actions(
            checkbox({ label: 'Encode values', checked: true, onChange: (checked) => { encode = checked; refresh() } }),
            checkbox({ label: 'Use + for spaces', hint: 'form style', onChange: (checked) => { formSpaces = checked; refresh() } }),
            checkbox({ label: 'Also encode path & fragment', onChange: (checked) => { encodeBase = checked; refresh() } }),
            checkbox({ label: 'Sort keys', onChange: (checked) => { sort = checked; refresh() } }),
          ),
        ),
        built,
        panel({ title: 'Parts', icon: 'layers' }, parts),
        panel({ title: 'Encode / decode whole URL', icon: 'swap' }, codec),
        status,
      ),
    )

    paramHint.textContent = 'Keys are decoded as you paste them; “+” becomes a space.'
    parseInput()
  },
}

export default tool

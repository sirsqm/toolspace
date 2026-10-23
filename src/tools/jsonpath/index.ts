import {
  actions,
  button,
  card,
  cards,
  chips,
  copyButton,
  field,
  note,
  outputBlock,
  panel,
  stat,
  stats,
  textarea,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  explainPath,
  JsonPathError,
  MAX_MATCHES,
  previewValue,
  runQuery,
  stringifyValue,
  type JsonValue,
} from './jsonpath'

const SAMPLE = JSON.stringify(
  {
    store: {
      book: [
        { title: 'Refactoring', price: 30, tags: ['code', 'craft'] },
        { title: 'Clean Code', price: 20, tags: ['code'] },
        { title: 'The Art', price: 45, tags: [] },
      ],
      bicycle: { color: 'red', price: 120 },
    },
    cheap: true,
  },
  null,
  2,
)

const EXAMPLES: { label: string; hint: string }[] = [
  { label: '$.store.book[*].title', hint: 'the title of every book' },
  { label: '$..price', hint: 'every price anywhere' },
  { label: '$.store.book[?(@.price < 30)]', hint: 'books under 30' },
  { label: '$.store.book[0:2]', hint: 'the first two books' },
  { label: '$.store.book[?(@.tags && @.price > 20)].title', hint: 'tagged books over 20' },
  { label: '$.store.book[0,2].title', hint: 'the first and third book' },
]

const tool: Tool = {
  slug: 'jsonpath',
  name: 'JSONPath Query',
  description: 'Run JSONPath queries against a document and inspect every match with its path.',
  category: 'Data',
  keywords: ['jsonpath', 'json', 'query', 'filter', 'select', 'jmespath', 'extract'],
  render(root) {
    const docInput = textarea({ rows: 14, value: SAMPLE, onInput: () => run() })
    docInput.id = 'ts-jp-doc'
    docInput.setAttribute('aria-describedby', 'ts-jp-doc-hint')

    const docHint = el('p', { class: 'ts-k-hint', id: 'ts-jp-doc-hint' }, 'Any JSON value — an object, an array, a bare string or number.')

    const path = textField({ value: '$.store.book[*].title', mono: true, onInput: () => run() })
    path.id = 'ts-jp-path'
    path.setAttribute('autocomplete', 'off')
    path.setAttribute('spellcheck', 'false')
    path.setAttribute('aria-describedby', 'ts-jp-steps')

    // Plain-language reading of the query, so the syntax teaches itself.
    const steps = el('p', { class: 'ts-k-hint ts-jp-steps', id: 'ts-jp-steps' })

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'assertive')

    const result = outputBlock('', {
      label: 'Matches',
      copy: () => output,
    })

    const matchCards = cards()
    const summary = stats()
    const empty = note('', 'neutral')

    let output = ''
    let currentPath = ''

    function clearResult(message: string, tone: 'neutral' | 'warn' = 'neutral') {
      output = ''
      result.setValue('—')
      result.setMeta('')
      result.setLabel('Matches')
      matchCards.replaceChildren()
      summary.replaceChildren()
      empty.textContent = message
      empty.className = `ts-k-note ts-k-note--${tone}`
      empty.hidden = false
    }

    function fail(message: string, fix?: string) {
      output = ''
      result.setValue('—')
      result.setMeta('')
      result.setLabel('Matches')
      matchCards.replaceChildren()
      summary.replaceChildren()
      error.replaceChildren(message, ...(fix ? [el('span', { class: 'ts-jp-fix' }, ` ${fix}`)] : []))
      error.hidden = false
      empty.hidden = true
    }

    function run() {
      const raw = docInput.value.trim()
      currentPath = path.value.trim()

      // Reading the path is independent of the document, so report a bad query
      // even when the document is empty or malformed — otherwise a typo looks
      // like a broken document.
      let reading: string[] = []
      if (currentPath) {
        try {
          reading = explainPath(currentPath)
        } catch (err) {
          steps.textContent = ''
          fail(err instanceof Error ? err.message : 'Could not read that path.', 'Check the syntax above and try one of the examples.')
          return
        }
      }
      steps.textContent = reading.length ? `Reads as: ${reading.join(' → ')}` : ''

      if (raw === '') {
        error.hidden = true
        clearResult('Paste a JSON document to run a query against it.')
        return
      }

      let document: JsonValue
      try {
        document = JSON.parse(raw) as JsonValue
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'That is not valid JSON.'
        fail(`The document is not valid JSON: ${detail}`, 'Fix the highlighted syntax in the document pane.')
        return
      }

      if (currentPath === '') {
        error.hidden = true
        clearResult('Enter a JSONPath, or pick one of the examples.', 'warn')
        return
      }

      try {
        const { matches, truncated } = runQuery(document, currentPath)
        error.hidden = true
        empty.hidden = true

        if (matches.length === 0) {
          clearResult('The query is valid but matched nothing. Check the spelling of each key, or try a wildcard (*) to see what is there.')
          return
        }

        output = JSON.stringify(matches.map((match) => ({ path: match.path, value: match.value })), null, 2)
        result.setLabel('Matches')
        result.setValue(output)
        result.setMeta(`${matches.length}${truncated ? `+ of ${MAX_MATCHES}` : ''} ${matches.length === 1 && !truncated ? 'match' : 'matches'}`)

        matchCards.replaceChildren(
          ...matches.slice(0, 200).map((match, index) =>
            card(
              { title: match.path },
              el('pre', { class: 'ts-jp-value ts-k-mono' }, previewValue(match.value)),
              actions(
                copyButton(() => stringifyValue(matches[index].value), { label: 'Copy value', size: 'sm' }),
                copyButton(() => matches[index].path, { label: 'Copy path', size: 'sm' }),
              ),
            ),
          ),
        )

        summary.replaceChildren(
          stat({ label: 'Matches', value: String(matches.length) }),
          stat({ label: 'Distinct paths', value: String(new Set(matches.map((match) => match.path)).size) }),
          stat({ label: 'Steps', value: String(reading.length) }),
          ...(truncated ? [stat({ label: 'Truncated', value: 'yes', hint: `first ${MAX_MATCHES} shown` })] : []),
        )

        if (truncated) {
          empty.textContent = `Stopped after ${MAX_MATCHES} matches to keep the page responsive. Narrow the query — for example add a filter or an index — to see the rest.`
          empty.className = 'ts-k-note ts-k-note--warn'
          empty.hidden = false
        } else if (matches.length > 200) {
          empty.textContent = `Showing the first 200 of ${matches.length} matches below; the full list is in the copyable output.`
          empty.className = 'ts-k-note ts-k-note--neutral'
          empty.hidden = false
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not run that query.'
        fail(message, err instanceof JsonPathError ? 'Adjust the path, or pick one of the examples.' : undefined)
      }
    }

    // Keyboard flow: Enter in the path field re-runs, and Up/Down step through
    // the examples without reaching for the mouse.
    let exampleIndex = -1
    path.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        run()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      exampleIndex = event.key === 'ArrowDown'
        ? (exampleIndex + 1) % EXAMPLES.length
        : (exampleIndex - 1 + EXAMPLES.length) % EXAMPLES.length
      path.value = EXAMPLES[exampleIndex].label
      run()
    })

    const exampleRow = chips(
      EXAMPLES.map((example) => ({
        label: example.label,
        title: example.hint,
        onClick: () => {
          path.value = example.label
          path.focus()
          run()
        },
      })),
    )

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Document', icon: 'code' },
          field(docInput, { label: 'JSON document', forId: docInput.id }),
          docHint,
        ),
        panel(
          { title: 'Query', icon: 'search' },
          field(path, { label: 'JSONPath', forId: path.id }),
          steps,
          exampleRow,
          actions(
            copyButton(() => output, { label: 'Copy results', size: 'sm' }),
            button('Clear document', {
              icon: 'eraser',
              variant: 'ghost',
              size: 'sm',
              onClick: () => {
                docInput.value = ''
                run()
                docInput.focus()
              },
            }),
          ),
          error,
        ),
        el('div', { 'aria-live': 'polite', class: 'ts-jp-live' }, summary, empty, result),
        panel({ title: 'Matches, one by one', icon: 'layers' }, matchCards),
        note('Supports child, wildcard, recursive descent, slices, unions and filters. Filters compare values only and never execute code.'),
      ),
    )

    run()
  },
}

export default tool

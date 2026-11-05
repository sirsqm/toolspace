import {
  actions,
  button,
  field,
  note,
  outputBlock,
  panel,
  segmented,
  select,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  escape,
  EscapeError,
  EXAMPLES,
  FLAVORS,
  FLAVOR_NOTES,
  unescape,
  type Flavor,
} from './escape'

const SAMPLE = 'He said "hi"\nand left.'

const tool: Tool = {
  slug: 'escape-toolkit',
  name: 'Escape / Unescape',
  description: 'Escape or unescape text for JSON, JS, HTML, XML, URL, SQL, shell, regex and CSV.',
  category: 'Text',
  keywords: ['escape', 'unescape', 'encode', 'decode', 'json', 'html', 'url', 'sql', 'shell', 'regex', 'csv'],
  render(root) {
    let direction: 'escape' | 'unescape' = 'escape'
    let flavor: Flavor = 'json'
    let rendered = ''

    const input = textarea({ rows: 6, placeholder: 'Paste or type text…', onInput: () => run() })
    input.id = 'ts-escape-input'
    input.setAttribute('autocomplete', 'off')

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    // A concise sentence for screen readers; the output block stays silent so a
    // keystroke is not announced twice.
    const status = el('p', { class: 'ts-escape-sr', role: 'status', 'aria-live': 'polite' })

    const output = outputBlock('', { label: 'Result', copy: () => rendered })

    const flavorHint = el('p', { class: 'ts-k-hint' })

    const mode = segmented({
      label: 'Direction',
      value: direction,
      items: [
        { value: 'escape', label: 'Escape' },
        { value: 'unescape', label: 'Unescape' },
      ],
      onChange: (value) => {
        direction = value as 'escape' | 'unescape'
        run()
      },
    })

    const flavorSelect = select({
      options: FLAVORS.map((item) => ({ value: item.value, label: item.label })),
      value: flavor,
      onChange: (value) => {
        flavor = value as Flavor
        run()
      },
    })
    flavorSelect.id = 'ts-escape-flavor'

    function blank(explain: string) {
      rendered = ''
      output.setValue('—')
      output.setLabel('Result')
      output.setMeta('')
      error.hidden = true
      status.textContent = ''
      flavorHint.textContent = explain
    }

    function run() {
      const text = input.value
      flavorHint.textContent = FLAVOR_NOTES[flavor]
      if (!text) {
        blank('Enter some text to see the result. The example button fills a realistic sample for this flavour.')
        return
      }
      try {
        rendered = direction === 'escape' ? escape(text, flavor) : unescape(text, flavor)
        output.setValue(rendered)
        output.setLabel(direction === 'escape' ? 'Escaped' : 'Unescaped')
        output.setMeta(`${rendered.length} ${rendered.length === 1 ? 'char' : 'chars'}`)
        error.hidden = true
        status.textContent = `${direction === 'escape' ? 'Escaped' : 'Unescaped'}, ${rendered.length} characters.`
      } catch (err) {
        rendered = ''
        output.setValue('')
        output.setMeta('')
        output.setLabel('Result')
        error.textContent =
          err instanceof EscapeError ? err.message : 'That text could not be unescaped for this flavour.'
        error.hidden = false
        status.textContent = 'Could not unescape that text.'
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Input', icon: 'text' },
          field(mode, { label: 'Direction' }),
          field(flavorSelect, { label: 'Flavour', forId: 'ts-escape-flavor' }),
          flavorHint,
          field(input, { label: 'Text', forId: 'ts-escape-input' }),
          error,
          actions(
            button('Load example', {
              icon: 'refresh',
              onClick: () => {
                input.value = direction === 'escape' ? EXAMPLES[flavor] : escape(EXAMPLES[flavor], flavor)
                run()
                input.focus()
              },
            }),
            button('Clear', {
              icon: 'eraser',
              variant: 'ghost',
              onClick: () => {
                input.value = ''
                run()
                input.focus()
              },
            }),
          ),
        ),
        output,
        status,
        note('The CSV flavour also blocks spreadsheet formula injection.'),
      ),
    )

    input.value = SAMPLE
    run()
  },
}

export default tool

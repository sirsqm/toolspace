import {
  actions,
  button,
  chips,
  checkbox,
  copyRow,
  field,
  kvList,
  note,
  outputBlock,
  panel,
  stat,
  stats,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import { breakdown, decimalBinaryGap, formatBytes, parseBytes } from './bytes'

/** One-click examples that show off the two scales without typing. */
const EXAMPLES: { label: string; value: string }[] = [
  { label: '1.5 MB', value: '1.5 MB' },
  { label: '1 GiB', value: '1 GiB' },
  { label: '1 TB disk', value: '1 TB' },
  { label: '700 MiB CD', value: '700 MiB' },
  { label: '100 Mbit', value: '100 Mbit' },
  { label: '4,294,967,296', value: '4,294,967,296' },
]

const tool: Tool = {
  slug: 'byte-size',
  name: 'Byte Size Converter',
  description: 'Convert between bytes, decimal kB/MB and binary KiB/MiB, with both scales side by side.',
  category: 'Numbers',
  keywords: ['bytes', 'size', 'kb', 'mb', 'kib', 'mib', 'storage', 'convert', 'human readable', 'bits', 'gib', 'disk'],
  render(root) {
    const input = textField({
      value: '1.5 MB',
      mono: true,
      placeholder: 'e.g. 1.5 MB',
      onInput: () => run(),
    })
    input.id = 'ts-bytes-input'
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')
    input.setAttribute('inputmode', 'text')

    const decimals = textField({ type: 'number', value: '2', mono: true, onInput: () => run() })
    decimals.id = 'ts-bytes-decimals'
    decimals.setAttribute('min', '0')
    decimals.setAttribute('max', '10')
    decimals.setAttribute('step', '1')
    decimals.setAttribute('inputmode', 'numeric')

    const hint = el(
      'p',
      { class: 'ts-k-hint', id: 'ts-bytes-hint' },
      'Accepts B, kB, KiB, MB, MiB, GB, GiB, TB, TiB — and bit/s variants such as Mbit. Decimal units step by 1000, binary units by 1024.',
    )
    input.setAttribute('aria-describedby', hint.id)

    let binary = false

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    // The visible figures are decorative; this one sentence is what a screen
    // reader hears, so typing a digit is not announced six times over.
    const srStatus = el('p', { class: 'ts-bytes-sr', role: 'status', 'aria-live': 'polite' })

    const summary = outputBlock('', { label: 'Formatted', copy: () => formatted })
    summary.classList.add('ts-bytes-block')
    const facts = stats()
    // `stats()` sets `display: grid`, which beats the UA `[hidden]` rule, so the
    // empty first run would otherwise still show a bare stat strip.
    facts.classList.add('ts-bytes-block')
    const rows = kvList()
    const gap = el('p', { class: 'ts-k-hint' })
    let formatted = ''

    const clear = button('Clear', {
      icon: 'eraser',
      variant: 'ghost',
      onClick: () => {
        input.value = ''
        run()
        input.focus()
      },
    })

    function hideResults() {
      summary.hidden = true
      facts.hidden = true
      gap.hidden = true
      gap.textContent = ''
      rows.replaceChildren()
    }

    function run() {
      const text = input.value.trim()
      if (!text) {
        formatted = ''
        hideResults()
        error.hidden = true
        srStatus.textContent = 'Enter a size to convert.'
        return
      }

    
      try {
        const parsed = parseBytes(text)
        formatted = formatBytes(parsed.bytes, { binary, decimals: Number(decimals.value) })
        summary.body.replaceChildren(formatted)
        summary.setMeta(parsed.exact ? parsed.bytes.toLocaleString('en-US') : 'approximate')
        summary.setLabel('Formatted')
        summary.hidden = false

        facts.replaceChildren(
          stat({ label: 'Exact bytes', value: parsed.exact ? parsed.bytes.toLocaleString('en-US') : 'not exact' }),
          stat({
            label: 'In bits',
            value: Number.isSafeInteger(parsed.bytes * 8)
              ? `${(parsed.bytes * 8).toLocaleString('en-US')} bit`
              : formatBytes(parsed.bytes * 8, { decimals: 2 }),
          }),
          stat({ label: 'Read as', value: parsed.unit === 'b' ? 'bytes' : parsed.unit }),
        )
        facts.hidden = false

        const gapPercent = decimalBinaryGap(parsed.bytes)
        if (gapPercent == null) {
          gap.textContent = 'Below 1000 bytes the two scales agree, so decimal and binary labels match.'
        } else {
          gap.textContent = `The same size is ${gapPercent.toFixed(1)}% larger when labelled with decimal units than with binary ones.`
        }
        gap.hidden = false

        rows.replaceChildren(...breakdown(parsed.bytes).map((row) => copyRow(row.label, row.value)))
        error.hidden = true
        srStatus.textContent = `${formatted}. ${parsed.exact ? `${parsed.bytes.toLocaleString('en-US')} bytes exactly.` : 'Approximate.'}`
      } catch (err) {
        formatted = ''
        hideResults()
        error.textContent = err instanceof Error ? err.message : 'Could not read that size.'
        error.hidden = false
        srStatus.textContent = 'Could not read that size.'
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Size', icon: 'ruler' },
          actions(
            field(input, { label: 'Value', grow: true, forId: input.id }),
            field(decimals, { label: 'Decimals', grow: true, forId: decimals.id }),
            clear,
          ),
          hint,
          chips(EXAMPLES.map((example) => ({
            label: example.label,
            title: `Use ${example.value}`,
            onClick: () => {
              input.value = example.value
              run()
              input.focus()
            },
          }))),
          checkbox({
            label: 'Binary units (1024) in the formatted result',
            onChange: (checked) => {
              binary = checked
              run()
            },
          }),
          error,
        ),
        summary,
        facts,
        panel({ title: 'Every scale', icon: 'layers' }, rows, gap),
        note('Decimal units use powers of 1000, binary units powers of 1024. Try "1 GB" and compare the two rows.'),
        srStatus,
      ),
    )

    run()
  },
}

export default tool

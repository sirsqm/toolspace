import {
  actions,
  button,
  checkbox,
  chips,
  copyButton,
  copyRow,
  field,
  grid,
  kvList,
  note,
  outputBlock,
  panel,
  select,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import { exactIntegerDigits, formatNumber, isValidLocale, normalizeDecimals, parseNumber, representations } from './format'

const LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'hi-IN', 'ja-JP']

/** One-click values so the page shows something before anything is typed. */
const EXAMPLES: { label: string; value: string }[] = [
  { label: '1234567.89', value: '1234567.89' },
  { label: '1.234,56', value: '1.234,56' },
  { label: '−2500', value: '-2500' },
  { label: '$1,299.00', value: '$1,299.00' },
  { label: '(1,500)', value: '(1,500)' },
  { label: '42', value: '42' },
]

/** Sizes and units: the values where grouping and compact form matter most. */
const UNIT_EXAMPLES: { label: string; value: string }[] = [
  { label: '1024', value: '1024' },
  { label: '1500000', value: '1500000' },
  { label: '0.5', value: '0.5' },
  { label: '9.81', value: '9.81' },
  { label: '−273.15', value: '-273.15' },
  { label: '1e6', value: '1e6' },
]

const tool: Tool = {
  slug: 'number-formatter',
  name: 'Number Formatter',
  description: 'Format a number for any locale and see its compact, currency, binary and word forms.',
  category: 'Numbers',
  keywords: ['number', 'format', 'locale', 'currency', 'percent', 'compact', 'thousands', 'words'],
  render(root) {
    const input = textField({ value: '1234567.89', mono: true, onInput: () => run() })
    input.id = 'ts-numfmt-value'
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')
    input.setAttribute('inputmode', 'decimal')

    const inputHint = el(
      'p',
      { class: 'ts-k-hint', id: 'ts-numfmt-hint' },
        'Accepts grouping marks, a leading sign, a currency symbol, accounting parentheses and scientific notation: 1,234.56 · 1.234,56 · −1 500 · ($1,200) · 1e6. A minus copied from a document is understood too.',
    )
    input.setAttribute('aria-describedby', inputHint.id)

    const locale = select({
      options: LOCALES.map((code) => ({ value: code, label: code })),
      value: 'en-US',
      onChange: () => run(),
    })
    locale.id = 'ts-numfmt-locale'

    const style = select({
      options: [
        { value: 'decimal', label: 'Decimal' },
        { value: 'currency', label: 'Currency' },
        { value: 'percent', label: 'Percent' },
        { value: 'unit', label: 'Unit' },
      ],
      value: 'decimal',
      onChange: () => run(),
    })
    style.id = 'ts-numfmt-style'

    const currency = textField({ value: 'USD', mono: true, onInput: () => run() })
    currency.id = 'ts-numfmt-currency'
    currency.setAttribute('autocomplete', 'off')
    currency.setAttribute('spellcheck', 'false')
    currency.setAttribute('maxlength', '3')

    const unit = textField({ value: 'kilometer', mono: true, onInput: () => run() })
    unit.id = 'ts-numfmt-unit'
    unit.setAttribute('autocomplete', 'off')
    unit.setAttribute('spellcheck', 'false')

    const decimals = textField({ type: 'number', value: '2', mono: true, onInput: () => run() })
    decimals.id = 'ts-numfmt-decimals'
    decimals.setAttribute('min', '0')
    decimals.setAttribute('max', '100')
    decimals.setAttribute('step', '1')
    decimals.setAttribute('inputmode', 'numeric')

    const sign = select({
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'always', label: 'Always' },
        { value: 'never', label: 'Never' },
        { value: 'exceptZero', label: 'Except zero' },
      ],
      value: 'auto',
      onChange: () => run(),
    })
    sign.id = 'ts-numfmt-sign'

    let compact = false

    // Only the relevant option stays visible, so a decimal format is not
    // cluttered with a currency box that does nothing.
    const currencyField = field(currency, { label: 'Currency code', hint: 'ISO 4217, e.g. EUR', forId: currency.id })
    const unitField = field(unit, { label: 'Unit', hint: 'Intl unit, e.g. kilometer', forId: unit.id })
    currencyField.classList.add('ts-numfmt-hide')
    unitField.classList.add('ts-numfmt-hide')

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    // One quiet sentence for screen readers; the visible blocks stay silent so
    // a keystroke is not announced twice over.
    const srStatus = el('p', { class: 'ts-numfmt-sr', role: 'status', 'aria-live': 'polite' })

    const rows = kvList()
    let main = ''
    let allText = ''
    const result = outputBlock('', { label: 'Formatted', copy: () => main })
    result.classList.add('ts-numfmt-hide')
    const empty = note('Type a number above — or pick an example — to see it formatted for the chosen locale.', 'neutral')
    const copyAll = copyButton(() => allText, { label: 'Copy all', size: 'sm' })
    const otherPanel = panel(
      { title: 'Other representations', icon: 'hash' },
      actions(copyAll),
      rows,
    )
    otherPanel.classList.add('ts-numfmt-hide')

    function hideResults() {
      result.hidden = true
      otherPanel.hidden = true
      empty.hidden = false
    }

    function run() {
      rows.replaceChildren()
      const text = input.value.trim()

      if (!text) {
        main = ''
        result.body.replaceChildren('')
        hideResults()
        error.hidden = true
        srStatus.textContent = 'Enter a number to format.'
        return
      }

      const localeCode = locale.value
      const unsupported = !isValidLocale(localeCode)

      try {
        const value = parseNumber(text)
        const digits = normalizeDecimals(decimals.value)
        main = formatNumber(value, {
          locale: unsupported ? 'en-US' : localeCode,
          style: style.value as 'decimal' | 'currency' | 'percent' | 'unit',
          currency: currency.value.trim(),
          unit: unit.value.trim(),
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
          compact,
          signDisplay: sign.value as 'auto' | 'always' | 'never' | 'exceptZero',
        })

        result.body.replaceChildren(main)
        result.setLabel('Formatted')
        // Intl formats a double, so a pasted integer past 2^53 comes back
        // rounded. Say so and show the digits that were actually typed.
        const exact = exactIntegerDigits(value, text)
        result.setMeta(
          unsupported
            ? 'locale not available — used a fallback'
            : exact
              ? `Intl formats a double; your exact digits are ${exact}`
              : '',
        )
        result.hidden = false
        empty.hidden = true
        otherPanel.hidden = false

        const lines = representations(value, unsupported ? 'en-US' : localeCode, text)
        allText = lines.map(([label, out]) => `${label}: ${out}`).join('\n')
        rows.replaceChildren(...lines.map(([label, out]) => copyRow(label, out)))
        error.hidden = true
        srStatus.textContent = `Formatted value ${main}.`
      } catch (err) {
        main = ''
        result.body.replaceChildren('')
        result.hidden = true
        otherPanel.hidden = true
        empty.hidden = true
        error.textContent = err instanceof Error ? err.message : 'Could not format that number.'
        error.hidden = false
        srStatus.textContent = error.textContent
      }
    }

    function syncOptionFields() {
      currencyField.hidden = style.value !== 'currency'
      unitField.hidden = style.value !== 'unit'
    }

    const exampleRow = chips(
      EXAMPLES.map((example) => ({
        label: example.label,
        title: `Use ${example.value}`,
        onClick: () => {
          input.value = example.value
          run()
          input.focus()
        },
      })),
    )
    exampleRow.setAttribute('role', 'group')
    exampleRow.setAttribute('aria-label', 'Example numbers')

    const unitRow = chips(
      UNIT_EXAMPLES.map((example) => ({
        label: example.label,
        title: `Use ${example.value}`,
        onClick: () => {
          input.value = example.value
          run()
          input.focus()
        },
      })),
    )
    unitRow.setAttribute('role', 'group')
    unitRow.setAttribute('aria-label', 'Example sizes and measurements')

    const examples = el(
      'div',
      { class: 'ts-numfmt-examples' },
      el('p', { class: 'ts-k-label' }, 'Try an example'),
      exampleRow,
      el('p', { class: 'ts-k-label' }, 'Sizes and measurements'),
      unitRow,
    )

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Format', icon: 'sliders' },
          field(input, { label: 'Number', forId: input.id }),
          inputHint,
          grid(160,
            field(locale, { label: 'Locale', forId: locale.id }),
            field(style, { label: 'Style', forId: style.id }),
            field(decimals, { label: 'Decimal places', hint: 'Blank keeps the default', forId: decimals.id }),
            field(sign, { label: 'Sign display', forId: sign.id }),
            currencyField,
            unitField,
          ),
          actions(checkbox({ label: 'Compact notation', onChange: (checked) => { compact = checked; run() } })),
          actions(button('Clear', { icon: 'eraser', variant: 'ghost', onClick: () => { input.value = ''; run(); input.focus() } })),
          error,
        ),
        examples,
        srStatus,
        result,
        empty,
        otherPanel,
        note('Parsing accepts "1,234.56" and "1.234,56" by looking at which separator comes last. Formatting uses the browser Intl data.'),
      ),
    )

    // Keep the currency/unit visibility in step with the style control.
    style.addEventListener('change', syncOptionFields)
    syncOptionFields()
    run()
  },
}

export default tool

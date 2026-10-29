import {
  actions,
  button,
  checkbox,
  chips,
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
import { isValidLocale, normalizeDecimals, parseNumber, representations } from './format'

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
      'Accepts grouping marks, a leading sign, a currency symbol and accounting parentheses: 1,234.56 · 1.234,56 · −1 500 · ($1,200).',
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
    const result = outputBlock('', { label: 'Formatted', copy: () => main })
    result.classList.add('ts-numfmt-hide')
    const empty = note('Type a number above — or pick an example — to see it formatted for the chosen locale.', 'neutral')
    const otherPanel = panel({ title: 'Other representations', icon: 'hash' }, rows)
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
        main = format({
          value,
          locale: localeCode,
          style: style.value as 'decimal' | 'currency' | 'percent' | 'unit',
          currency: currency.value.trim(),
          unit: unit.value.trim(),
          digits,
          compact,
          sign: sign.value as 'auto' | 'always' | 'never' | 'exceptZero',
        })

        result.body.replaceChildren(main)
        result.setLabel('Formatted')
        result.setMeta(unsupported ? 'locale not available — used a fallback' : '')
        result.hidden = false
        empty.hidden = true
        otherPanel.hidden = false

        rows.replaceChildren(
          ...representations(value, unsupported ? 'en-US' : localeCode).map(([label, out]) => copyRow(label, out)),
        )
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

    function format(options: {
      value: number
      locale: string
      style: 'decimal' | 'currency' | 'percent' | 'unit'
      currency: string
      unit: string
      digits: number | undefined
      compact: boolean
      sign: 'auto' | 'always' | 'never' | 'exceptZero'
    }): string {
      if (options.style === 'currency' && !/^[A-Za-z]{3}$/.test(options.currency)) {
        throw new Error(`"${options.currency || '(empty)'}" is not a three-letter currency code — try USD or EUR.`)
      }
      if (options.style === 'unit' && !options.unit) {
        throw new Error('Enter a unit for the unit format — try kilometer, byte or liter.')
      }
      const safeLocale = isValidLocale(options.locale) ? options.locale : 'en-US'
      try {
        return new Intl.NumberFormat(safeLocale, {
          style: options.style,
          notation: options.compact ? 'compact' : 'standard',
          currency: options.style === 'currency' ? options.currency.toUpperCase() : undefined,
          unit: options.style === 'unit' ? options.unit : undefined,
          minimumFractionDigits: options.digits,
          maximumFractionDigits: options.digits,
          signDisplay: options.sign,
        }).format(options.value)
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'that option is not supported'
        throw new Error(`Could not format with these options: ${detail}`)
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
        exampleRow,
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

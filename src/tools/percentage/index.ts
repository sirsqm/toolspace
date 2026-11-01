import { el } from '../../core/dom'
import {
  actions,
  button,
  copyButton,
  field,
  grid,
  note,
  panel,
  table,
  textarea,
  textField,
  toolLayout,
} from '../../core/components'
import type { Tool } from '../../core/types'
import {
  applyDiscount,
  breakdownParts,
  describeChange,
  formatNumber,
  formatPercent,
  marginAndMarkup,
  parseNumber,
  parseParts,
  PercentageError,
  percentOf,
  percentOfTotal,
  reversePercent,
} from './percentage'

interface NumField {
  input: HTMLInputElement
  node: HTMLElement
}

let seq = 0

/**
 * A numeric text field. Deliberately `type="text"` with a decimal inputmode:
 * `type="number"` rejects a pasted "1,250" or "25%" outright, and this tool
 * accepts both (see `parseNumber`).
 */
function numberField(label: string, value: string): NumField {
  const id = `ts-pct-${(seq += 1)}`
  const input = textField({ value, type: 'text', mono: true })
  input.id = id
  input.setAttribute('inputmode', 'decimal')
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('spellcheck', 'false')
  return { input, node: field(input, { label, forId: id }) }
}

interface ResultRow {
  value: HTMLElement
  meta: HTMLElement
  node: HTMLElement
}

/**
 * The payoff line of each card: the live result, an optional plain-language
 * qualifier, and a copy chip. The value is deliberately not an aria-live
 * region — six of them firing on every keystroke would drown a screen reader.
 * One hidden status line below the page carries the summary instead.
 */
function resultRow(label = 'Result'): ResultRow {
  const value = el('span', { class: 'ts-percent-value' })
  const meta = el('span', { class: 'ts-percent-meta' })
  meta.hidden = true
  const node = el(
    'div',
    { class: 'ts-percent-result' },
    el('span', { class: 'ts-percent-result__label' }, label),
    value,
    meta,
    copyButton(() => value.textContent ?? '', { size: 'sm' }),
  )
  return { value, meta, node }
}

/**
 * What the Examples button restores. Every box is named, so a value can never
 * land in the wrong field — the old flat list shifted the whole page and left
 * the weights box empty. The split is written with names to show the format.
 */
const EXAMPLE: Record<string, string> = {
  ofPercent: '20',
  ofValue: '150',
  partValue: '25',
  totalValue: '200',
  changeFrom: '100',
  changeTo: '150',
  reverseResult: '150',
  reversePercentValue: '50',
  price: '200',
  discount: '25',
  cost: '80',
  sellPrice: '100',
  splitTotal: '1,250',
  split: 'Rent: 500\nFood: 300\nSavings: 200\nFun: 250',
}

const tool: Tool = {
  slug: 'percentage',
  name: 'Percentage Calculator',
  description: 'Work out shares, increases, decreases, discounts and margins without guessing.',
  category: 'Numbers',
  keywords: ['percentage', 'percent', 'increase', 'decrease', 'discount', 'markup', 'margin', 'share'],
  render(root) {
    const ofPercent = numberField('Percentage (%)', '20')
    const ofValue = numberField('Of value', '150')
    const partValue = numberField('Part', '25')
    const totalValue = numberField('Total', '200')
    const changeFrom = numberField('From', '100')
    const changeTo = numberField('To', '150')
    const reverseResult = numberField('Result', '150')
    const reversePercentValue = numberField('Was changed by (%)', '50')
    const price = numberField('Price', '200')
    const discount = numberField('Discount (%)', '25')
    const cost = numberField('Cost', '80')
    const sellPrice = numberField('Price', '100')
    const splitTotal = numberField('Total to split', '100')

    const shareResult = resultRow()
    const totalResult = resultRow('Share')
    const changeResult = resultRow('Change')
    const reverseOut = resultRow('Original value')
    const discountResult = resultRow('You pay')
    const marginResult = resultRow('Margin · markup')

    const allInputs = [
      ofPercent,
      ofValue,
      partValue,
      totalValue,
      changeFrom,
      changeTo,
      reverseResult,
      reversePercentValue,
      price,
      discount,
      cost,
      sellPrice,
      splitTotal,
    ]

    const splitInput = textarea({
      rows: 4,
      value: 'Rent: 500\nFood: 300\nSavings: 200\nFun: 250',
      placeholder: 'Rent: 500\nFood: 300',
      onInput: () => compute(),
    })
    splitInput.id = 'ts-pct-split'
    const splitHintId = 'ts-pct-split-hint'
    const splitOut = el('div', { class: 'ts-percent-split' })

    // One hidden line is what a screen reader hears, so a keystroke is not
    // announced six times over by six separate live regions.
    const srStatus = el('p', { class: 'ts-percent-sr', role: 'status', 'aria-live': 'polite' })
    const spoken: string[] = []

    const splitField = field(splitInput, {
      label: 'Parts',
      forId: splitInput.id,
      hint: 'One part per line as “Name: number”, or just numbers. Parts can also be separated by semicolons, or by commas when each is named (“Rent: 500, Food: 300”). A comma between thousands (“1,250”) stays part of the number. Bigger numbers get bigger shares.',
    })
    // The kit's hint has no id of its own; point the textarea at it so a
    // screen reader hears the format rule when the box takes focus.
    splitField.querySelector('.ts-k-hint')?.setAttribute('id', splitHintId)
    splitInput.setAttribute('aria-describedby', splitHintId)

    function labelOf(target: NumField): string {
      return target.node.querySelector('.ts-k-label')?.textContent ?? 'Value'
    }

    const number = (target: NumField) => parseNumber(target.input.value, labelOf(target))

    /**
     * Run one panel's maths and paint its row. Errors are specific and name the
     * field, and a blank box says so instead of silently reporting 0.
     */
    function paint(row: ResultRow, name: string, compute: () => { text: string; meta?: string }) {
      try {
        const { text, meta } = compute()
        row.value.textContent = text
        row.value.classList.remove('is-error')
        if (meta) {
          row.meta.textContent = meta
          row.meta.hidden = false
          spoken.push(`${name}: ${text}, ${meta}`)
        } else {
          row.meta.hidden = true
          spoken.push(`${name}: ${text}`)
        }
      } catch (err) {
        const message = err instanceof PercentageError ? err.message : 'Could not read those values'
        row.value.textContent = message
        row.value.classList.add('is-error')
        row.meta.hidden = true
        spoken.push(`${name}: ${message}`)
      }
    }

    function compute() {
      spoken.length = 0
      paint(shareResult, 'Share of a value', () => ({ text: formatNumber(percentOf(number(ofPercent), number(ofValue))) }))
      paint(totalResult, 'Part as a share', () => ({ text: formatPercent(percentOfTotal(number(partValue), number(totalValue))) }))
      paint(changeResult, 'Change', () => {
        const change = describeChange(number(changeFrom), number(changeTo))
        if (change.percent == null) return { text: 'Undefined', meta: 'the starting value is zero' }
        return {
          text: formatPercent(change.percent),
          meta:
            change.direction === 'unchanged'
              ? 'no change'
              : change.direction === 'increase'
                ? 'increase'
                : 'decrease',
        }
      })
      paint(reverseOut, 'Reverse a change', () => ({ text: formatNumber(reversePercent(number(reverseResult), number(reversePercentValue))) }))
      paint(discountResult, 'Discount', () => {
        const original = number(price)
        const final = applyDiscount(original, number(discount))
        return { text: formatNumber(final), meta: `saving ${formatNumber(original - final)}` }
      })
      paint(marginResult, 'Margin and markup', () => {
        const result = marginAndMarkup(number(cost), number(sellPrice))
        return {
          text: `${formatPercent(result.margin)} · ${formatPercent(result.markup)}`,
          meta: `profit ${formatNumber(number(sellPrice) - number(cost))}`,
        }
      })
      paintSplit()
      srStatus.textContent = spoken.join('. ')
    }

    function paintSplit() {
      try {
        const total = number(splitTotal)
        const parts = parseParts(splitInput.value, 'Each part')
        const rows = breakdownParts(total, parts, 2)
        const sum = rows.reduce((running, row) => running + row.amount, 0)
        splitOut.replaceChildren(
          table(
            [
              { key: 'part', label: 'Part' },
              { key: 'weight', label: 'Weight', mono: true },
              { key: 'share', label: 'Share', mono: true },
              { key: 'amount', label: 'Amount', mono: true },
            ],
            rows.map((row) => ({
              part: row.name ?? String(row.index),
              weight: formatNumber(row.weight),
              share: formatPercent(row.share),
              amount: formatNumber(row.amount),
            })),
          ),
          note(`The amounts add up to ${formatNumber(sum)} — the whole total, with the rounding pennies handed out to the largest remainders.`),
        )
        spoken.push(`Split of ${formatNumber(total)} across ${rows.length} parts`)
      } catch (err) {
        const message = err instanceof PercentageError ? err.message : 'Could not read those parts'
        splitOut.replaceChildren(note(message, 'danger'))
        spoken.push(`Split: ${message}`)
      }
    }

    for (const { input } of allInputs) input.addEventListener('input', compute)

    function setValues(values: Partial<Record<keyof typeof EXAMPLE, string>>) {
      const byInput = new Map<HTMLInputElement, string | undefined>([
        [ofPercent.input, values.ofPercent],
        [ofValue.input, values.ofValue],
        [partValue.input, values.partValue],
        [totalValue.input, values.totalValue],
        [changeFrom.input, values.changeFrom],
        [changeTo.input, values.changeTo],
        [reverseResult.input, values.reverseResult],
        [reversePercentValue.input, values.reversePercentValue],
        [price.input, values.price],
        [discount.input, values.discount],
        [cost.input, values.cost],
        [sellPrice.input, values.sellPrice],
        [splitTotal.input, values.splitTotal],
      ])
      for (const [input, value] of byInput) input.value = value ?? ''
      splitInput.value = values.split ?? ''
    }

    root.append(
      toolLayout(
        { wide: true },
        actions(
          button('Examples', {
            icon: 'refresh',
            variant: 'ghost',
            onClick: () => {
              setValues(EXAMPLE)
              compute()
              ofPercent.input.focus()
            },
          }),
          button('Clear all', {
            icon: 'eraser',
            variant: 'ghost',
            onClick: () => {
              setValues({})
              compute()
              ofPercent.input.focus()
            },
          }),
          el('span', { class: 'ts-k-hint' }, 'Boxes accept plain numbers, and also pasted “1,250” or “25%”. Press Alt+1–7 to jump between panels.'),
        ),
        grid(
          300,
          panel(
            { title: 'Share of a value', icon: 'hash', meta: 'a% of b' },
            ofPercent.node,
            ofValue.node,
            shareResult.node,
          ),
          panel(
            { title: 'Part as a share', icon: 'ruler', meta: 'part ÷ total' },
            partValue.node,
            totalValue.node,
            totalResult.node,
          ),
          panel(
            { title: 'Change between two values', icon: 'arrowUp', meta: 'from → to' },
            changeFrom.node,
            changeTo.node,
            changeResult.node,
          ),
          panel(
            { title: 'Reverse a change', icon: 'arrowDown', meta: 'undo a %' },
            reverseResult.node,
            reversePercentValue.node,
            reverseOut.node,
          ),
          panel(
            { title: 'Discount', icon: 'eraser', meta: 'price − %' },
            price.node,
            discount.node,
            discountResult.node,
          ),
          panel(
            { title: 'Margin and markup', icon: 'sliders', meta: 'cost vs price' },
            cost.node,
            sellPrice.node,
            marginResult.node,
          ),
        ),
        panel(
          { title: 'Split a total into shares', icon: 'layers' },
          splitTotal.node,
          splitField,
          splitOut,
        ),
        note('Dividing by zero shows the reason rather than Infinity. Margin is profit over price, markup is profit over cost. The split panel hands rounding pennies to the largest remainders, so the amounts always add back to the total.'),
        srStatus,
      ),
    )

    // Alt+1..7 focuses the first box of each panel, so the whole page can be
    // driven without a mouse and without tabbing through every control.
    const jumpTargets = [
      ofPercent.input,
      partValue.input,
      changeFrom.input,
      reverseResult.input,
      price.input,
      cost.input,
      splitTotal.input,
    ]
    root.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      const index = Number(event.key) - 1
      const target = jumpTargets[index]
      if (!target) return
      event.preventDefault()
      target.focus()
      target.select()
    })

    compute()
  },
}

export default tool

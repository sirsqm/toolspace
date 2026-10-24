import {
  actions,
  button,
  chips,
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
import {
  formatAmount,
  formatClock,
  formatDuration,
  largestUnit,
  parseDuration,
  toIsoDuration,
  UNITS,
} from './duration'

/** One-click examples that show the shapes the parser accepts. */
const EXAMPLES: { label: string; value: string }[] = [
  { label: '1h30m', value: '1h30m' },
  { label: '2 days 4 hours', value: '2 days 4 hours' },
  { label: 'PT1H30M', value: 'PT1H30M' },
  { label: '01:30', value: '01:30' },
  { label: '90s', value: '90s' },
  { label: '2 weeks', value: '2 weeks' },
  { label: '45 (seconds)', value: '45' },
  { label: '-1h30m', value: '-1h30m' },
]

const tool: Tool = {
  slug: 'duration-parser',
  name: 'Duration Parser',
  description: 'Read loose durations like "1h30m" or "P1DT2H" and convert them to every unit at once.',
  category: 'Numbers',
  icon: 'clock',
  keywords: ['duration', 'time', 'parse', 'iso 8601', 'hours', 'minutes', 'seconds', 'timespan'],
  render(root) {
    const input = textField({
      value: '1h30m',
      mono: true,
      placeholder: '1h30m, 2 days 4 hours, PT1H30M, 01:30',
      onInput: () => run(),
    })
    input.id = 'ts-duration-input'
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')
    input.setAttribute('inputmode', 'text')

    const hint = el(
      'p',
      { class: 'ts-k-hint', id: 'ts-duration-hint' },
      'Accepts "1h30m", words ("2 days 4 hours"), clock times ("01:30" or "1:30:15"), ISO-8601 ("P1DT2H") and a bare number, which is read as seconds. A leading minus sign makes the duration negative.',
    )
    input.setAttribute('aria-describedby', hint.id)

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('role', 'alert')

    // The visible panels carry the answer; this one line is what a screen
    // reader hears, so typing a digit is not announced eight times over.
    const srStatus = el('p', { class: 'ts-duration-sr', role: 'status', 'aria-live': 'polite' })

    const primary = outputBlock('', { label: 'Duration', copy: () => primary.body.textContent ?? '' })
    primary.classList.add('ts-duration-block')
    const facts = stats()
    facts.classList.add('ts-duration-block')
    const rows = kvList()

    let iso = ''

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
      primary.hidden = true
      facts.hidden = true
      rows.replaceChildren()
    }

    function run() {
      const text = input.value.trim()
      if (!text) {
        iso = ''
        hideResults()
        error.hidden = true
        srStatus.textContent = 'Enter a duration to convert.'
        return
      }

      try {
        const ms = parseDuration(text)
        iso = toIsoDuration(ms)
        primary.body.replaceChildren(formatDuration(ms, { long: true }))
        primary.setMeta(`${formatDuration(ms)} · ${formatClock(ms)}`)
        primary.setLabel('Duration')
        primary.hidden = false

        const unit = largestUnit(ms)
        facts.replaceChildren(
          stat({ label: 'Milliseconds', value: ms.toLocaleString('en-US') }),
          stat({ label: 'ISO 8601', value: iso }),
          stat({
            label: 'Largest unit',
            value: unit.ms === 1 ? 'milliseconds' : unit.names[1] ?? unit.names[0],
          }),
        )
        facts.hidden = false

        rows.replaceChildren(
          copyRow('ISO 8601', iso),
          ...UNITS.map((item) => copyRow(item.names[1] ?? item.names[0], formatAmount(ms / item.ms))),
        )
        error.hidden = true
        srStatus.textContent = `${formatDuration(ms, { long: true })}, ${iso}.`
      } catch (err) {
        iso = ''
        hideResults()
        error.textContent = err instanceof Error ? err.message : 'Could not read that duration.'
        error.hidden = false
        srStatus.textContent = 'Could not read that duration.'
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Duration', icon: 'clock' },
          actions(
            field(input, { label: 'Duration', grow: true, forId: input.id }),
            clear,
          ),
          hint,
          chips(EXAMPLES.map((example) => ({
            label: example.label,
            title: `Use ${example.value}`,
            onClick: (value) => {
              input.value = value
              run()
              input.focus()
            },
          }))),
          error,
        ),
        primary,
        facts,
        panel({ title: 'Every unit', icon: 'layers' }, rows),
        note('A bare number is read as seconds. Years are 365.25 days and months are 30.44 days, the same averages used by duration libraries.'),
        srStatus,
      ),
    )

    run()
  },
}

export default tool

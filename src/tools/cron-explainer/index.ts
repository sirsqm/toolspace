import {
  card,
  cards,
  checkbox,
  chips,
  copyRow,
  field,
  grid,
  kvList,
  note,
  outputBlock,
  panel,
  segmented,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  buildCron,
  expandMacro,
  FREQUENCIES,
  macros,
  MAX_SEARCH_YEARS,
  parseCron,
  presets,
  type Frequency,
  type ScheduleSpec,
} from './cron'

const DAY_LABELS = [
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
]

/** Number boxes clamp themselves and still fire onInput for every change. */
function numberField(label: string, value: number, onInput: () => void): HTMLInputElement {
  const input = textField({ type: 'number', value: String(value), mono: true, onInput: () => onInput() })
  input.id = `ts-cron-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return input
}

const tool: Tool = {
  slug: 'cron-explainer',
  name: 'Cron Expression Explainer',
  description: 'Read a 5-field cron expression in plain English, build one visually, and see the next run times.',
  category: 'Web',
  keywords: ['cron', 'crontab', 'schedule', 'expression', 'explain', 'builder', 'cron expression'],
  render(root) {
    root.classList.add('ts-cron')
    let mode: 'explain' | 'build' = 'explain'

    /* ------------------------------- explain -------------------------------- */
    const input = textField({ value: '0 9 * * 1-5', mono: true, onInput: () => run() })
    input.id = 'ts-cron-input'
    input.spellcheck = false
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('autocapitalize', 'off')

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('role', 'alert')

    // One line for screen readers; the visible panels carry the same answer, so
    // typing a digit is not announced five times over.
    const srStatus = el('p', { class: 'ts-cron-sr', role: 'status', 'aria-live': 'polite' })

    const summary = note('')
    const summaryMeta = el('p', { class: 'ts-cron-meta' })
    const fields = cards()
    const runsList = kvList()
    const runsEmpty = note('', 'warn')
    runsEmpty.hidden = true

    const summaryPanel = panel({ title: 'In plain English', icon: 'text' }, summary, summaryMeta)
    const fieldsPanel = panel({ title: 'Fields', icon: 'layers' }, fields)
    const runsPanel = panel({ title: 'Upcoming runs', icon: 'calendar' }, runsList, runsEmpty)

    const presetRow = chips(
      presets().map((preset) => ({
        label: preset.label,
        title: `Use ${preset.expression}`,
        onClick: () => {
          input.value = preset.expression
          run()
          input.focus()
        },
      })),
    )
    presetRow.setAttribute('aria-label', 'Example schedules')

    const macroRow = chips(
      macros().map((macro) => ({
        label: macro.alias,
        title: `Use ${macro.expression}`,
        onClick: () => {
          input.value = macro.alias
          run()
          input.focus()
        },
      })),
    )
    macroRow.setAttribute('aria-label', 'Named shortcuts')

    const explainPanel = panel(
      { title: 'Expression', icon: 'clock' },
      field(input, { label: 'Expression', forId: input.id, hint: 'minute · hour · day-of-month · month · day-of-week' }),
      presetRow,
      macroRow,
      error,
    )

    function setPanels(showResults: boolean) {
      summaryPanel.hidden = !showResults
      fieldsPanel.hidden = !showResults
      runsPanel.hidden = !showResults
    }

    function run() {
      const result = parseCron(input.value)
      if (!result.valid) {
        error.textContent = result.error ?? 'Invalid expression'
        error.hidden = false
        summary.textContent = ''
        summaryMeta.textContent = ''
        fields.replaceChildren()
        runsList.replaceChildren()
        runsEmpty.hidden = true
        setPanels(false)
        srStatus.textContent = result.error ?? 'Invalid expression'
        return
      }

      error.hidden = true
      summary.textContent = result.description
      summaryMeta.textContent = result.macro
        ? `${result.macro} is shorthand for ${expandMacro(result.macro) ?? ''}`
        : ''
      summaryMeta.hidden = !result.macro

      fields.replaceChildren(...result.fields.map((item) => card({ title: item.name, meta: item.value }, item.description)))

      runsList.replaceChildren(
        ...result.next.map((date, index) =>
          copyRow(`#${index + 1}`, date.toLocaleString(), { copy: false }),
        ),
      )
      runsEmpty.textContent = result.exhausted
        ? `No runs in the next ${MAX_SEARCH_YEARS} years — check the day and month fields.`
        : ''
      runsEmpty.hidden = !result.exhausted
      runsList.hidden = result.exhausted
      setPanels(true)

      const firstRun = result.next[0]
      srStatus.textContent = firstRun
        ? `${result.description}. Next run ${firstRun.toLocaleString()}.`
        : `${result.description}. No runs in the next ${MAX_SEARCH_YEARS} years.`
    }

    /* ------------------------------- builder -------------------------------- */
    let frequency: Frequency = 'daily'
    const minute = numberField('Minute', 0, () => build())
    const hour = numberField('Hour', 9, () => build())
    const dayOfMonth = numberField('Day of month', 1, () => build())
    const weekdayBoxes = DAY_LABELS.map((day) =>
      checkbox({ label: day.label, checked: day.value === '1', onChange: () => build() }),
    )
    const builtOutput = outputBlock('', { label: 'Expression', copy: () => builtValue })
    let builtValue = ''

    const frequencyControl = segmented({
      label: 'Runs',
      value: frequency,
      items: FREQUENCIES.map((item) => ({ value: item.value, label: item.label })),
      onChange: (value) => {
        frequency = value as Frequency
        build()
      },
    })

    const minuteField = field(minute, { label: 'Minute (0–59)', forId: minute.id })
    const hourField = field(hour, { label: 'Hour (0–23)', forId: hour.id })
    const dayField = field(dayOfMonth, { label: 'Day of month (1–31)', forId: dayOfMonth.id })

    // A real fieldset so the weekday boxes are announced as one group.
    const weekdayField = el(
      'fieldset',
      { class: 'ts-cron-fieldset' },
      el('legend', { class: 'ts-k-label' }, 'Days of the week'),
      grid(90, ...weekdayBoxes),
    )

    function build() {
      const spec: ScheduleSpec = {
        frequency,
        minute: Number(minute.value) || 0,
        hour: Number(hour.value) || 0,
        dayOfMonth: Number(dayOfMonth.value) || 1,
        weekdays: weekdayBoxes
          .map((box, index) => ({ checked: (box.querySelector('input') as HTMLInputElement).checked, index }))
          .filter((entry) => entry.checked)
          .map((entry) => entry.index),
      }
      builtValue = buildCron(spec)
      builtOutput.body.replaceChildren(builtValue)
      const check = parseCron(builtValue)
      builtOutput.setMeta(check.valid ? check.description : check.error ?? '')

      const needsTime = frequency !== 'minutely'
      minuteField.hidden = !needsTime
      hourField.hidden = frequency === 'hourly' || frequency === 'minutely'
      dayField.hidden = frequency !== 'monthly'
      weekdayField.hidden = frequency !== 'weekly'

      // Keep the explainer in step when a schedule is built.
      input.value = builtValue
      run()
    }

    const buildPanel = panel(
      { title: 'Build', icon: 'sliders' },
      frequencyControl,
      grid(180, minuteField, hourField),
      dayField,
      weekdayField,
      builtOutput,
    )
    buildPanel.hidden = true

    const modeControl = segmented({
      label: 'Mode',
      value: mode,
      items: [
        { value: 'explain', label: 'Explain' },
        { value: 'build', label: 'Build' },
      ],
      onChange: (value) => {
        mode = value as 'explain' | 'build'
        explainPanel.hidden = mode !== 'explain'
        buildPanel.hidden = mode !== 'build'
      },
    })

    root.append(
      toolLayout(
        { wide: true },
        panel({ title: 'Mode', icon: 'grid' }, modeControl),
        explainPanel,
        buildPanel,
        summaryPanel,
        fieldsPanel,
        runsPanel,
        note('Cron times use the machine\u2019s local time zone. When both the day-of-month and day-of-week fields are set, a run happens if either matches — the same rule Vixie cron uses.'),
        srStatus,
      ),
    )

    build()
  },
}

export default tool

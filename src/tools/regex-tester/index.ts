import {
  actions,
  card,
  cards,
  checkbox,
  chips,
  copyButton,
  copyRow,
  field,
  kvList,
  note,
  panel,
  stat,
  stats,
  textarea,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import { explain, FLAGS, highlight, runRegex, type MatchInfo } from './regex'

const DEFAULT_PATTERN = '\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]+\\b'
const DEFAULT_TEXT = 'Contact dev@example.com or ops@team.io today.'
const MAX_CARDS = 200

const EXAMPLES: { label: string; pattern: string; text: string; hint: string }[] = [
  {
    label: 'Email address',
    pattern: '\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]+\\b',
    text: 'Contact dev@example.com or ops@team.io today.',
    hint: 'Match simple email addresses',
  },
  {
    label: 'Date (named groups)',
    pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
    text: 'Released 2024-05-01, revised 2025-11-30.',
    hint: 'Capture year, month and day by name',
  },
  {
    label: 'Hex colour',
    pattern: '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\\b',
    text: 'Ink #4f8cff on #0e1116, plus a short #f80.',
    hint: '3- or 6-digit hex colour codes',
  },
  {
    label: 'Repeated whitespace',
    pattern: '\\s{2,}',
    text: 'One  two   three    four',
    hint: 'Two or more whitespace characters in a row',
  },
]

/** Strip the engine's echo of the pattern so the reason stays readable. */
function cleanError(message: string): string {
  return message
    .replace(/^Invalid regular expression:\s*\/[\s\S]*?\/[a-z]*:\s*/i, '')
    .replace(/^Invalid regular expression:\s*/i, '')
}

const tool: Tool = {
  slug: 'regex-tester',
  name: 'Regex Tester & Explainer',
  description: 'Test a regular expression against text and read a plain-English breakdown.',
  category: 'Text',
  keywords: ['regex', 'regexp', 'regular expression', 'match', 'capture group', 'pattern'],
  render(root) {
    const flags = new Set<string>(['g'])

    const pattern = textField({
      value: DEFAULT_PATTERN,
      mono: true,
      placeholder: 'e.g. \\d{4}-\\d{2}-\\d{2}',
      spellcheck: false,
      onInput: () => run(),
    })
    pattern.id = 'ts-regex-pattern'
    pattern.setAttribute('autocomplete', 'off')
    pattern.setAttribute('autocapitalize', 'off')

    const sample = textarea({ rows: 6, value: DEFAULT_TEXT, onInput: () => run() })
    sample.id = 'ts-regex-sample'
    sample.setAttribute('spellcheck', 'false')

    // The error note announces itself when it appears; the match count is
    // announced by `srStatus` below so the two never repeat each other.
    const error = note('', 'danger')
    error.classList.add('ts-regex-error')
    error.hidden = true
    error.setAttribute('role', 'alert')

    const srStatus = el('p', { class: 'ts-regex-sr', role: 'status', 'aria-live': 'polite' })

    const preview = el('div', { class: 'ts-regex-preview' })
    const summary = stats()
    const matches = cards()
    const explanation = cards()

    const flagBoxes = FLAGS.map((flag) =>
      checkbox({
        label: flag.label,
        hint: `— ${flag.hint}`,
        checked: flags.has(flag.value),
        onChange: (checked) => {
          if (checked) flags.add(flag.value)
          else flags.delete(flag.value)
          run()
        },
      }),
    )

    const exampleChips = chips(
      EXAMPLES.map((example) => ({
        label: example.label,
        title: example.hint,
        onClick: () => {
          pattern.value = example.pattern
          sample.value = example.text
          run()
          pattern.focus()
        },
      })),
    )

    function flagString(): string {
      return FLAGS.filter((flag) => flags.has(flag.value))
        .map((flag) => flag.value)
        .join('')
    }

    function valueRow(label: string, value: string | undefined): HTMLElement {
      if (value === undefined) return copyRow(label, '(did not participate)', { copy: false })
      return copyRow(label, value || '(empty)', { copy: value.length > 0 })
    }

    function renderMatch(match: MatchInfo, index: number): HTMLElement {
      const rows = kvList()
      rows.append(valueRow('Value', match.value))
      match.groups.forEach((group, groupIndex) => rows.append(valueRow(`Group ${groupIndex + 1}`, group)))
      const named = Object.entries(match.named)
      if (named.length) {
        rows.append(el('p', { class: 'ts-k-hint' }, 'Named groups'))
        for (const [name, value] of named) rows.append(valueRow(name, value))
      }
      return card({ title: `Match ${index + 1}`, meta: `at ${match.index}` }, rows)
    }

    function paintPreview(): void {
      preview.replaceChildren(
        ...highlight(sample.value, runRegex(pattern.value, flagString(), sample.value).matches).map((part) =>
          el('span', part.match ? { class: 'ts-regex-hit' } : {}, part.text),
        ),
      )
    }

    function run(): void {
      const active = flagString()
      const result = runRegex(pattern.value, active, sample.value)

      if (result.error) {
        error.textContent = `That pattern is not valid: ${cleanError(result.error)}`
        error.hidden = false
        preview.replaceChildren(el('span', {}, sample.value))
        summary.replaceChildren()
        matches.replaceChildren(note('Fix the pattern above to see matches.'))
        explanation.replaceChildren(...explain(pattern.value).map((item) => card({ title: item.token }, item.meaning)))
        srStatus.textContent = 'Pattern error.'
        return
      }

      error.hidden = true
      paintPreview()

      const count = result.matches.length
      summary.replaceChildren(
        stat({ label: count === 1 ? 'Match' : 'Matches', value: String(count) }),
        stat({ label: 'Flags', value: active || 'none' }),
        stat({ label: 'Test text', value: `${[...sample.value].length} chars` }),
      )

      const shown = result.matches.slice(0, MAX_CARDS)
      matches.replaceChildren(
        ...(shown.length
          ? shown.map((match, index) => renderMatch(match, index))
          : [note(pattern.value ? 'No matches in the test text.' : 'Type a pattern to begin.')]),
      )
      if (result.matches.length > shown.length) {
        matches.append(note(`Showing the first ${shown.length} of ${result.matches.length} matches.`))
      }
      if (result.truncated) {
        matches.append(note('The match list was capped. Narrow the pattern to see every match.', 'warn'))
      }

      explanation.replaceChildren(...explain(pattern.value).map((item) => card({ title: item.token }, item.meaning)))

      srStatus.textContent = `${count} ${count === 1 ? 'match' : 'matches'}.`
    }

    const copyAll = copyButton(
      () => runRegex(pattern.value, flagString(), sample.value).matches.map((match) => match.value).join('\n'),
      { label: 'Copy all values', size: 'sm' },
    )

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Pattern', icon: 'search' },
          field(pattern, {
            label: 'Regular expression',
            forId: 'ts-regex-pattern',
            hint: 'JavaScript syntax. Matching happens in this tab — the pattern and text are never sent anywhere.',
          }),
          el('div', { class: 'ts-regex-flags' }, ...flagBoxes),
          error,
        ),
        panel({ title: 'Examples', icon: 'sparkle' }, exampleChips),
        panel(
          { title: 'Test text', icon: 'text' },
          field(sample, { label: 'Text to test against', forId: 'ts-regex-sample' }),
          preview,
        ),
        panel({ title: 'Matches', icon: 'layers' }, actions(copyAll), summary, matches),
        panel({ title: 'Explanation', icon: 'info' }, explanation),
        srStatus,
      ),
    )

    run()
  },
}

export default tool

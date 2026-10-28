import {
  actions,
  badge,
  button,
  chips,
  copyButton,
  field,
  note,
  panel,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import { analyse, formatSpecificity, specificityKey, type Specificity } from './specificity'

/** Examples that show the shapes the scorer understands. */
const EXAMPLES: { label: string; value: string }[] = [
  { label: '.card .title', value: '.card .title' },
  { label: '#main a:hover', value: '#main a:hover' },
  { label: 'ul > li::before', value: 'ul > li::before' },
  { label: '[type="text"]', value: '[type="text"]' },
  { label: ':is(#a, .b)', value: ':is(#a, .b)' },
  { label: ':not(.a) .b', value: ':not(.a) .b' },
  { label: ':where(#a)', value: ':where(#a)' },
  { label: 'a !important', value: 'a !important' },
]

/** "1 class", "2 classes", "1 element", … */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** The triple spelled out in words, e.g. "1 id · 2 classes". */
function describe(s: Specificity): string {
  const parts: string[] = []
  if (s.ids) parts.push(plural(s.ids, 'id', 'ids'))
  if (s.classes) parts.push(plural(s.classes, 'class', 'classes'))
  if (s.elements) parts.push(plural(s.elements, 'element', 'elements'))
  return parts.length > 0 ? parts.join(' · ') : 'nothing'
}

const tool: Tool = {
  slug: 'css-specificity',
  name: 'CSS Specificity Calculator',
  description: 'Score and rank CSS selectors, and see how their specificity compares.',
  category: 'Design',
  keywords: ['css', 'specificity', 'selector', 'cascade', 'important', 'ranking'],
  render(root) {
    const input = textarea({
      rows: 6,
      placeholder: '.card .title, #main a:hover, ul > li',
      onInput: () => run(),
    })
    input.id = 'ts-spec-input'
    input.setAttribute('autocomplete', 'off')

    const summary = el('div', { class: 'ts-k-chips' })
    const issues = el('div', { class: 'ts-spec-issues' })
    const output = el('div', { class: 'ts-spec-list' })

    const emptyState = el(
      'div',
      { class: 'ts-spec-empty' },
      el('p', { class: 'ts-spec-empty__title' }, 'Nothing to score yet.'),
      el(
        'p',
        { class: 'ts-spec-empty__body' },
        'Type a selector above, or pick an example. Scores read as (ids, classes, elements) — the bigger the leftmost number, the more specific the selector.',
      ),
    )

    // One concise line for screen readers, so a keystroke is not announced
    // eight separate times as the panels repaint.
    const srStatus = el('p', { class: 'ts-spec-sr', role: 'status', 'aria-live': 'polite' })

    const clear = button('Clear', {
      icon: 'eraser',
      variant: 'ghost',
      onClick: () => {
        input.value = ''
        run()
        input.focus()
      },
    })

    function rankingText(): string {
      const report = analyse(input.value)
      return report.sorted
        .map(
          (score) =>
            `${formatSpecificity(score.specificity)}\t${score.selector}${score.important ? ' !important' : ''}`,
        )
        .join('\n')
    }

    function renderIssues(messages: { selector: string; message: string }[]) {
      issues.replaceChildren(
        ...messages.map((issue) =>
          el(
            'p',
            { class: 'ts-k-note ts-k-note--warn' },
            el('code', { class: 'ts-spec-issue__selector' }, issue.selector),
            ` — ${issue.message}`,
          ),
        ),
      )
      issues.hidden = messages.length === 0
    }

    function run() {
      const report = analyse(input.value)
      summary.replaceChildren()
      renderIssues(report.issues)

      if (report.scores.length === 0) {
        emptyState.hidden = false
        output.replaceChildren(emptyState)
        srStatus.textContent = 'Enter a selector to score it.'
        return
      }

      // A half-parsed rule set scores nonsense (the declaration reads as an
      // element), so hold the ranking back until the text is a real selector.
      if (report.issues.length > 0) {
        emptyState.hidden = true
        output.replaceChildren(
          el(
            'div',
            { class: 'ts-spec-empty' },
            el('p', { class: 'ts-spec-empty__title' }, 'No ranking yet.'),
            el(
              'p',
              { class: 'ts-spec-empty__body' },
              'Fix the problem above and the score appears here — a score from text that is not a selector would only mislead.',
            ),
          ),
        )
        srStatus.textContent = `${plural(report.issues.length, 'problem', 'problems')} found, so no ranking was produced.`
        return
      }

      emptyState.hidden = true
      const pills: HTMLElement[] = [
        badge(`${report.scores.length} selector${report.scores.length === 1 ? '' : 's'}`),
        badge(`highest ${formatSpecificity(report.max)}`, 'accent'),
      ]
      if (report.tiedTop) pills.push(badge('top score is tied', 'warn'))
      summary.append(...pills)

      const maxKey = specificityKey(report.max)
      const tiedCount = report.scores.filter((score) => specificityKey(score.specificity) === maxKey).length
      const isTop = (score: Specificity) => report.tiedTop && specificityKey(score) === maxKey

      output.replaceChildren(
        ...report.sorted.map((score) =>
          el(
            'div',
            {
              class: `ts-spec-row${isTop(score.specificity) ? ' ts-spec-top' : ''}`,
              'data-key': specificityKey(score.specificity),
            },
            el(
              'div',
              { class: 'ts-spec-row__main' },
              el('code', { class: 'ts-spec-selector' }, score.selector),
              el('span', { class: 'ts-spec-score' }, formatSpecificity(score.specificity)),
              score.important ? badge('!important', 'danger') : null,
            ),
            el('span', { class: 'ts-spec-breakdown' }, describe(score.specificity)),
          ),
        ),
      )

      const lead = report.tiedTop
        ? `${report.scores.length} selectors. The top score ${formatSpecificity(report.max)} is shared by ${tiedCount} selectors.`
        : `${report.scores.length} selectors. Highest is ${report.sorted[0].selector} at ${formatSpecificity(report.max)}.`
      srStatus.textContent = lead
    }

    const copyAll = copyButton(() => rankingText(), { label: 'Copy ranking', size: 'sm' })

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Selectors', icon: 'code' },
          field(input, {
            label: 'Selectors',
            grow: true,
            forId: input.id,
            hint: 'Paste one selector, a comma-separated list, or a whole rule set — each part is scored on its own.',
          }),
          actions(clear),
          chips(
            EXAMPLES.map((example) => ({
              label: example.label,
              title: `Use ${example.value}`,
              onClick: (value) => {
                input.value = value
                run()
                input.focus()
              },
            })),
          ),
          summary,
          issues,
        ),
        panel(
          { title: 'Ranking', icon: 'chart' },
          el(
            'div',
            { class: 'ts-spec-head' },
            el('span', { class: 'ts-spec-head__hint' }, 'Most specific first'),
            copyAll,
          ),
          output,
        ),
        note('Attribute and pseudo-class selectors count as classes; pseudo-elements count as elements. :where() adds nothing, while :is(), :not() and :has() take their most specific argument.'),
        srStatus,
      ),
    )

    run()
  },
}

export default tool

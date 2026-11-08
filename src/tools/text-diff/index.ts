import {
  actions,
  badge,
  button,
  checkbox,
  field,
  grid,
  note,
  panel,
  segmented,
  stat,
  stats,
  table,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  diffLines,
  diffRows,
  diffStats,
  diffWords,
  foldRows,
  inlineSides,
  lineCount,
  sideCounts,
  type DiffOptions,
  type DiffRow,
  type FoldedRow,
  type InlineRun,
} from './diff'
import { closestPairs, levenshtein, similarityPercent } from './similarity'

const BEFORE = `the quick brown fox
jumps over the lazy dog
the end`

const AFTER = `the quick red fox
jumps over the lazy dog
the very end`

const EXAMPLE_BEFORE = `function greet(name) {
  console.log("hello " + name)
  return true
}`

const EXAMPLE_AFTER = `function greet(name, greeting = "hello") {
  console.log(\`\${greeting} \${name}\`)
  return true
}`

type Mode = 'line' | 'word' | 'text'

const tool: Tool = {
  slug: 'text-diff',
  name: 'Text Diff Viewer',
  description: 'Compare two blocks of text line by line or word by word.',
  category: 'Text',
  keywords: ['diff', 'compare', 'changes', 'patch', 'side by side'],
  render(root) {
    let mode: Mode = 'line'
    let ignoreCase = false
    let ignoreWhitespace = false
    let fold = true

    const before = textarea({ rows: 10, mono: true, value: BEFORE, onInput: () => render() })
    before.id = 'ts-diff-before'
    before.setAttribute('autocomplete', 'off')
    before.spellcheck = false

    const after = textarea({ rows: 10, mono: true, value: AFTER, onInput: () => render() })
    after.id = 'ts-diff-after'
    after.setAttribute('autocomplete', 'off')
    after.spellcheck = false

    const modeControl = segmented({
      label: 'Compare',
      items: [
        { value: 'line', label: 'Lines' },
        { value: 'word', label: 'Words' },
        { value: 'text', label: 'Similarity' },
      ],
      value: mode,
      onChange: (value) => {
        mode = value as Mode
        render()
      },
    })

    const summary = el('div', { class: 'ts-diff-summary' })
    const diffView = el('div', { class: 'ts-diff', tabindex: '0' })
    diffView.setAttribute('role', 'region')
    diffView.setAttribute('aria-label', 'Diff result')

    const empty = el(
      'div',
      { class: 'ts-diff-empty' },
      el('p', { class: 'ts-diff-empty__lead' }, 'Paste text into both boxes to see what changed.'),
      el('p', { class: 'ts-k-hint' }, 'Use Swap sides to flip the panes, or Load example for a worked pair.'),
    )

    // A concise sentence for screen readers; the diff itself is visual, so the
    // count of changes is the useful thing to announce, once.
    const status = el('p', { class: 'ts-diff-sr', role: 'status', 'aria-live': 'polite' })

    const similarityStats = stats()
    const pairTable = el('div')
    const changesPanel = panel({ title: 'Changes', icon: 'columns' }, summary, empty, diffView)
    const similarityPanel = panel({ title: 'Similarity', icon: 'chart' }, similarityStats, pairTable)

    const leftCount = el('span', { class: 'ts-diff-count' })
    const rightCount = el('span', { class: 'ts-diff-count' })

    const swap = button('Swap sides', {
      icon: 'swap',
      onClick: () => {
        const text = before.value
        before.value = after.value
        after.value = text
        render()
        after.focus()
      },
    })

    const clear = button('Clear both', {
      icon: 'eraser',
      onClick: () => {
        before.value = ''
        after.value = ''
        render()
        before.focus()
      },
    })

    const example = button('Load example', {
      icon: 'wand',
      onClick: () => {
        before.value = EXAMPLE_BEFORE
        after.value = EXAMPLE_AFTER
        render()
        before.focus()
      },
    })

    const ignoreCaseBox = checkbox({
      label: 'Ignore case',
      hint: 'treat "Foo" and "foo" as the same line',
      checked: ignoreCase,
      onChange: (checked) => {
        ignoreCase = checked
        render()
      },
    })

    const ignoreWhitespaceBox = checkbox({
      label: 'Ignore whitespace',
      hint: 'collapse spacing and trim line ends',
      checked: ignoreWhitespace,
      onChange: (checked) => {
        ignoreWhitespace = checked
        render()
      },
    })

    const foldBox = checkbox({
      label: 'Fold unchanged lines',
      hint: 'keep three lines of context around each change',
      checked: fold,
      onChange: (checked) => {
        fold = checked
        render()
      },
    })

    const options = (): DiffOptions => ({ ignoreCase, ignoreWhitespace })

    function inlineSpans(runs: InlineRun[], side: 'left' | 'right'): Node[] {
      return runs.map((run) => {
        const tone =
          run.type === 'equal' ? 'equal' : side === 'left' ? 'remove' : 'add'
        return el('span', { class: `ts-diff-inline ts-diff-inline--${tone}` }, run.value)
      })
    }

    function lineCell(side: 'left' | 'right', row: DiffRow): HTMLElement {
      const number = side === 'left' ? row.leftNumber : row.rightNumber
      const text = side === 'left' ? row.left : row.right
      const changed = row.inline.length > 0
      const tone = row.type === 'equal' ? 'equal' : side === 'left' ? 'remove' : 'add'

      let content: Node
      if (changed) {
        const sides = inlineSides(row.inline)
        content = el('span', { class: 'ts-diff-code' }, ...inlineSpans(side === 'left' ? sides.left : sides.right, side))
      } else if (text === '') {
        // An empty line still needs a box so the row keeps its height.
        content = el('span', { class: 'ts-diff-code' }, el('span', { class: 'ts-diff-inline' }, '\u00a0'))
      } else {
        content = el('span', { class: 'ts-diff-code' }, el('span', { class: 'ts-diff-inline' }, text))
      }

      return el(
        'div',
        { class: `ts-diff-cell ts-diff-cell--${tone}${number == null ? ' ts-diff-cell--gap' : ''}` },
        el('span', { class: 'ts-diff-lineno', 'aria-hidden': 'true' }, number == null ? '' : String(number)),
        content,
      )
    }

    const rowElement = (row: DiffRow): HTMLElement =>
      el('div', { class: `ts-diff-row ts-diff-row--${row.type}` }, lineCell('left', row), lineCell('right', row))

    const foldElement = (count: number): HTMLElement =>
      el(
        'button',
        {
          class: 'ts-diff-fold',
          type: 'button',
          onclick: () => {
            fold = false
            ;(foldBox.querySelector('input') as HTMLInputElement).checked = false
            render()
          },
        },
        `Show ${count} unchanged line${count === 1 ? '' : 's'}`,
      )

    function renderLineDiff(): string {
      const rows = diffRows(before.value, after.value, options())
      const view: FoldedRow[] = fold ? foldRows(rows) : rows
      diffView.replaceChildren(
        ...view.map((row) => ('folded' in row ? foldElement(row.folded) : rowElement(row))),
      )
      const added = rows.filter((row) => row.type === 'add').length
      const removed = rows.filter((row) => row.type === 'remove').length
      const hidden = view.reduce((sum, row) => sum + ('folded' in row ? row.folded : 0), 0)
      return `${added} added, ${removed} removed${hidden ? `, ${hidden} unchanged folded` : ''}`
    }

    function renderWordDiff(): string {
      const parts = diffWords(before.value, after.value)
      diffView.replaceChildren(
        ...parts.map((part) => {
          const marker = part.type === 'add' ? '+ ' : part.type === 'remove' ? '− ' : '  '
          return el(
            'div',
            { class: `ts-diff-part ts-diff-${part.type}` },
            el('span', { class: 'ts-diff-marker', 'aria-hidden': 'true' }, marker),
            el('span', { class: 'ts-diff-text' }, part.value),
          )
        }),
      )
      const stats = diffStats(parts)
      return `${stats.added} word${stats.added === 1 ? '' : 's'} added, ${stats.removed} removed`
    }

    function renderDiff() {
      const bLines = lineCount(before.value)
      const aLines = lineCount(after.value)
      leftCount.textContent = `${bLines} line${bLines === 1 ? '' : 's'}`
      rightCount.textContent = `${aLines} line${aLines === 1 ? '' : 's'}`

      diffView.classList.toggle('ts-diff--words', mode === 'word')

      if (mode === 'word') {
        const stats = diffStats(diffWords(before.value, after.value))
        summary.replaceChildren(badge(`+${stats.added} words`, 'ok'), badge(`−${stats.removed} words`, 'danger'))
      } else {
        const stats = diffStats(diffLines(before.value, after.value, options()))
        summary.replaceChildren(
          badge(`+${stats.added}`, 'ok'),
          badge(`−${stats.removed}`, 'danger'),
          badge(`${stats.unchanged} unchanged`),
        )
      }

      empty.hidden = true
      diffView.hidden = false
      status.textContent = mode === 'line' ? renderLineDiff() : renderWordDiff()
    }

    function renderSimilarity() {
      const percent = similarityPercent(before.value, after.value)
      const distance = levenshtein(before.value, after.value)
      const { before: bCount, after: aCount } = sideCounts(before.value, after.value)
      const rows = closestPairs(before.value, after.value)
      similarityStats.replaceChildren(
        stat({ label: 'Similarity', value: `${percent}%`, hint: 'whole documents' }),
        stat({ label: 'Edit distance', value: String(distance), hint: 'characters changed' }),
        stat({ label: 'Length', value: `${before.value.length} → ${after.value.length}` }),
        stat({ label: 'Lines', value: `${bCount} → ${aCount}` }),
      )
      pairTable.replaceChildren(
        rows.length
          ? table(
              [
                { key: 'percent', label: 'Match' },
                { key: 'distance', label: 'Distance' },
                { key: 'a', label: 'Before', mono: true },
                { key: 'b', label: 'After', mono: true },
              ],
              rows.map((row) => ({
                percent: `${row.percent}%`,
                distance: String(row.distance),
                a: row.a,
                b: row.b,
              })),
            )
          : note('No distinct line pairs to compare.'),
      )
      status.textContent = `${percent}% similar, edit distance ${distance}.`
    }

    function renderEmpty() {
      summary.replaceChildren()
      diffView.replaceChildren()
      diffView.hidden = true
      empty.hidden = false
      similarityStats.replaceChildren()
      pairTable.replaceChildren()
      leftCount.textContent = '0 lines'
      rightCount.textContent = '0 lines'
      status.textContent = 'Nothing to compare yet.'
    }

    function render() {
      const similarity = mode === 'text'
      changesPanel.hidden = similarity
      similarityPanel.hidden = !similarity

      if (!before.value && !after.value) {
        renderEmpty()
        return
      }

      if (similarity) renderSimilarity()
      else renderDiff()
    }

    const beforeField = field(before, { label: 'Before', forId: 'ts-diff-before' })
    beforeField.append(leftCount)
    const afterField = field(after, { label: 'After', forId: 'ts-diff-after' })
    afterField.append(rightCount)

    const optionRow = el('div', { class: 'ts-diff-options' }, ignoreCaseBox, ignoreWhitespaceBox, foldBox)

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Compare', icon: 'sliders' },
          modeControl,
          grid(240, beforeField, afterField),
          actions(swap, clear, example),
          optionRow,
        ),
        changesPanel,
        similarityPanel,
        status,
        note('Similarity uses Levenshtein edit distance: 100% means identical, 0% means nothing in common.'),
      ),
    )

    render()
  },
}

export default tool

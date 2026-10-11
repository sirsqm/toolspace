import {
  actions,
  button,
  checkbox,
  copyButton,
  dropzone,
  field,
  note,
  panel,
  select,
  stat,
  stats,
  table,
  textarea,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import { download } from '../../core/ui'
import type { Tool } from '../../core/types'
import { frequency, longestWord, parseIntField, toCsv, toTsv, type FrequencyOptions } from './wordfreq'

const SAMPLE = `The quick brown fox jumps over the lazy dog.
The dog barks, and the fox runs away.
A quick fox is a lucky fox.`

/** Pause in typing before recounting, so a long paste is counted once. */
const DEBOUNCE_MS = 150

const tool: Tool = {
  slug: 'word-frequency',
  name: 'Word Frequency Counter',
  description: 'Count word and n-gram frequency, with stop-word filtering and a share of total.',
  category: 'Text',
  keywords: ['word', 'frequency', 'count', 'ngram', 'bigram', 'occurrences', 'analysis', 'keywords'],
  render(root) {
    const input = textarea({
      rows: 10,
      mono: false,
      value: SAMPLE,
      onInput: () => schedule(),
    })
    input.id = 'ts-wf-text'

    const phrase = select({
      options: [
        { value: '1', label: 'Single words' },
        { value: '2', label: 'Two-word phrases' },
        { value: '3', label: 'Three-word phrases' },
        { value: '4', label: 'Four-word phrases' },
      ],
      value: '1',
      onChange: () => run(),
    })
    phrase.id = 'ts-wf-phrase'

    const sort = select({
      options: [
        { value: 'count', label: 'Most frequent first' },
        { value: 'alpha', label: 'A to Z' },
      ],
      value: 'count',
      onChange: () => run(),
    })
    sort.id = 'ts-wf-sort'

    const minLength = textField({ type: 'number', value: '1', mono: true, onInput: () => schedule() })
    minLength.id = 'ts-wf-min'
    minLength.min = '1'
    minLength.max = '200'

    const top = textField({ type: 'number', value: '25', mono: true, onInput: () => schedule() })
    top.id = 'ts-wf-top'
    top.min = '0'

    let caseSensitive = false
    let ignoreStopWords = false
    let ignoreNumbers = false
    let stem = false

    const warnings = note('', 'warn')
    warnings.hidden = true
    warnings.setAttribute('role', 'status')

    const figures = stats()
    figures.setAttribute('aria-live', 'polite')

    const status = el('p', { class: 'ts-wf-sr', role: 'status' })
    const empty = note('Type or paste text, or drop a text file, to see the words it uses.')
    const results = el('div', { class: 'ts-wf-results' })

    let exportEntries = frequency('', {})
    let timer: number | undefined

    const fileDrop = dropzone({
      label: 'Drop a text file',
      hint: 'or choose one to count its words',
      accept: 'text/*,.txt,.md,.csv,.log,.json',
      readAs: 'text',
      onFiles: () => {},
      onText: (text) => {
        input.value = text
        run()
      },
    })

    function schedule() {
      window.clearTimeout(timer)
      timer = window.setTimeout(run, DEBOUNCE_MS)
    }

    function run() {
      const min = parseIntField(minLength.value, 1, 1, 200)
      const limit = parseIntField(top.value, 0, 0, 100_000)

      const problems: string[] = []
      if (min.invalid) {
        problems.push(`Minimum word length must be a whole number from 1 to 200, so ${min.value} was used.`)
      }
      if (limit.invalid) {
        problems.push(`"Show top" must be zero or more, so ${limit.value} was used.`)
      }
      warnings.textContent = problems.join(' ')
      warnings.hidden = problems.length === 0

      const options: FrequencyOptions = {
        ngramSize: Number(phrase.value),
        minLength: min.value,
        top: limit.value,
        caseSensitive,
        ignoreStopWords,
        ignoreNumbers,
        stem,
        sort: sort.value === 'alpha' ? 'alpha' : 'count',
      }
      const report = frequency(input.value, options)
      exportEntries = report

      const words = report.totalWords
      const shown = report.entries.length
      const label = Number(phrase.value) === 1 ? 'word' : 'phrase'
      // entries[0] is only the most common when sorted by count, so find it outright.
      const topTerm = report.entries.reduce<(typeof report.entries)[number] | undefined>(
        (best, entry) => (!best || entry.count > best.count ? entry : best),
        undefined,
      )
      const longest = longestWord(input.value)
      const longestShown = longest.length > 24 ? `${longest.slice(0, 23)}…` : longest

      figures.replaceChildren(
        stat({ label: 'Words counted', value: words.toLocaleString() }),
        stat({ label: 'Distinct terms', value: report.uniqueWords.toLocaleString() }),
        stat({ label: `${label === 'word' ? 'Occurrences' : 'Phrases'} found`, value: report.totalTerms.toLocaleString() }),
        stat({ label: 'Longest word', value: longestShown || '—' }),
      )
      figures.lastElementChild?.setAttribute('title', longest)

      if (words === 0) {
        empty.textContent = input.value.trim()
          ? 'No words found. Try turning off the length, number or stop-word filters.'
          : 'Type or paste text, or drop a text file, to see the words it uses.'
        empty.hidden = false
        results.replaceChildren()
        status.textContent = 'No words to count.'
        return
      }

      empty.hidden = true
      const capped = shown < report.uniqueWords
      const lead = sort.value === 'alpha' ? 'First' : 'Top'
      status.textContent = capped
        ? `Showing the ${lead.toLowerCase()} ${shown} of ${report.uniqueWords} ${label}s.`
        : `Showing all ${shown} ${label}${shown === 1 ? '' : 's'}.`
      const ranked = sort.value === 'alpha' ? 'in alphabetical order' : 'ranked by count'
      const most = topTerm
        ? sort.value === 'alpha'
          ? ` “${topTerm.term}” is the most common, ${topTerm.count.toLocaleString()} times.`
          : ` “${topTerm.term}” appears most often, ${topTerm.count.toLocaleString()} times.`
        : ''
      results.replaceChildren(
        el('p', { class: 'ts-wf-caption' },
          capped
            ? `${lead} ${shown} of ${report.uniqueWords.toLocaleString()} distinct ${label}s, ${ranked}.`
            : `All ${shown.toLocaleString()} distinct ${label}${shown === 1 ? '' : 's'}, ${ranked}.`,
          most,
        ),
        table(
          [
            { key: 'term', label: label === 'word' ? 'Word' : 'Phrase', mono: true },
            { key: 'count', label: 'Count' },
            { key: 'share', label: 'Share' },
            { key: 'percent', label: 'Percent' },
          ],
          report.entries.map((entry) => ({
            term: entry.term,
            count: entry.count.toLocaleString(),
            share: el(
              'div',
              { class: 'ts-wf-bar', 'aria-hidden': 'true' },
              el('div', { class: 'ts-wf-bar-fill', style: `width:${entry.percent.toFixed(1)}%` }),
            ),
            percent: `${entry.percent.toFixed(1)}%`,
          })),
        ),
      )
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Text', icon: 'text' },
          field(input, { label: 'Text to count', forId: 'ts-wf-text' }),
          fileDrop.root,
          actions(
            button('Load sample', {
              icon: 'refresh',
              onClick: () => {
                input.value = SAMPLE
                run()
              },
            }),
            button('Clear', {
              icon: 'close',
              onClick: () => {
                input.value = ''
                run()
                input.focus()
              },
            }),
          ),
        ),
        panel(
          { title: 'Counting', icon: 'sliders' },
          actions(
            field(phrase, { label: 'Count', forId: 'ts-wf-phrase' }),
            field(sort, { label: 'Order', forId: 'ts-wf-sort' }),
            field(minLength, { label: 'Shortest word', forId: 'ts-wf-min', hint: 'Characters', grow: true }),
            field(top, { label: 'Show top', forId: 'ts-wf-top', hint: '0 shows every term', grow: true }),
          ),
          actions(
            checkbox({ label: 'Ignore case', checked: true, onChange: (checked) => { caseSensitive = !checked; run() } }),
            checkbox({ label: 'Ignore stop words', onChange: (checked) => { ignoreStopWords = checked; run() } }),
            checkbox({ label: 'Ignore numbers', onChange: (checked) => { ignoreNumbers = checked; run() } }),
            checkbox({ label: 'Group word endings', hint: 'e.g. cat and cats', onChange: (checked) => { stem = checked; run() } }),
          ),
        ),
        warnings,
        panel(
          { title: 'Result', icon: 'list' },
          actions(figures),
          actions(
            copyButton(() => toTsv(exportEntries.entries), { label: 'Copy TSV', size: 'sm' }),
            copyButton(() => toCsv(exportEntries.entries), { label: 'Copy CSV', size: 'sm' }),
            button('Download CSV', {
              icon: 'download',
              size: 'sm',
              onClick: () => download('word-frequency.csv', toCsv(exportEntries.entries), 'text/csv'),
            }),
          ),
          status,
          empty,
          results,
        ),
        note('Words keep internal apostrophes and hyphens, so “don’t” and “well-known” count as one.'),
      ),
    )

    run()
  },
}

export default tool

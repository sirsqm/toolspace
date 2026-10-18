import {
  actions,
  button,
  copyButton,
  field,
  note,
  outputBlock,
  panel,
  split,
  stat,
  stats as statStrip,
  table,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import { decodeHtml, encodeHtml, inspect, summarise, type CharInfo } from './unicode'

const SAMPLE = 'café 😀 \u200b&nbsp;'

/** The list is capped so a huge paste cannot build an unbounded amount of DOM. */
const ROW_LIMIT = 300

const tool: Tool = {
  slug: 'unicode-inspector',
  name: 'Unicode & HTML Entity Inspector',
  description: 'Break text into code points and encode or decode HTML entities.',
  category: 'Text',
  keywords: ['unicode', 'codepoint', 'html entity', 'escape', 'emoji', 'utf-8', 'utf8', 'grapheme', 'surrogate'],
  render(root) {
    const input = textarea({ rows: 3, placeholder: `Paste text, e.g. ${SAMPLE}`, onInput: () => update() })
    input.id = 'ts-unicode-input'
    input.spellcheck = false
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('autocorrect', 'off')

    // One spoken sentence per change; the visible panels carry the same answer,
    // so a screen reader is not read a wall of numbers on every keystroke.
    const status = el('p', { class: 'ts-unicode-sr', role: 'status', 'aria-live': 'polite' })

    const summary = statStrip()
    // Anything that makes the text not-well-formed is worth saying out loud,
    // because it changes what the byte count means.
    const flags = el('div', { class: 'ts-unicode-flags' })

    const encodeOut = outputBlock('', { label: 'Encoded', copy: () => encodeHtml(input.value) })
    const decodeOut = outputBlock('', { label: 'Decoded', copy: () => decodeHtml(input.value) })

    const charTable = table(
      [
        { key: 'char', label: 'Char' },
        { key: 'code', label: 'Code point', mono: true },
        { key: 'decimal', label: 'Decimal', mono: true },
        { key: 'js', label: 'JS', mono: true },
        { key: 'html', label: 'HTML', mono: true },
        { key: 'utf8', label: 'UTF-8', mono: true },
        { key: 'category', label: 'Category' },
      ],
      [],
    )
    const codePointPanel = panel({ title: 'Code points', icon: 'list', meta: `first ${ROW_LIMIT} rows` })
    const codePoints = el('div')
    codePoints.append(charTable)
    codePointPanel.body.append(codePoints)

    function describe(info: CharInfo): string {
      const bytes = `${info.utf8Length} byte${info.utf8Length === 1 ? '' : 's'} in UTF-8`
      const name = info.name ? `, ${info.name}` : ''
      return `${info.unicode}, ${info.category.toLowerCase()}${name}, ${bytes}.`
    }

    function row(info: CharInfo): HTMLElement {
      return el(
        'tr',
        {},
        el(
          'td',
          {},
          el(
            'span',
            { class: 'ts-unicode-char', 'aria-hidden': 'true', title: describe(info) },
            info.display,
          ),
          // The visible cell may be a stand-in or nothing at all; this is the
          // spoken form, so the row still makes sense without sight of it.
          el('span', { class: 'ts-unicode-sr' }, describe(info)),
        ),
        el('td', { class: 'ts-k-mono' }, info.unicode),
        el('td', { class: 'ts-k-mono' }, info.decimal),
        el('td', { class: 'ts-k-mono' }, info.js),
        el('td', { class: 'ts-k-mono' }, info.html),
        el('td', { class: 'ts-k-mono' }, info.utf8),
        el('td', {}, info.category),
      )
    }

    function emptyState() {
      summary.replaceChildren(
        stat({ label: 'Code points', value: '0', hint: 'Unicode values' }),
        stat({ label: 'Graphemes', value: '0', hint: 'what a reader sees' }),
        stat({ label: 'UTF-16 units', value: '0', hint: 'JavaScript .length' }),
        stat({ label: 'UTF-8 bytes', value: '0', hint: 'bytes on the wire' }),
        stat({ label: 'ASCII / other', value: '0 / 0', hint: 'code points below 128' }),
      )
      encodeOut.setValue('')
      decodeOut.setValue('')
      encodeOut.setMeta('')
      decodeOut.setMeta('')
      codePoints.replaceChildren(
        note('Each character, with its code point, escapes and UTF-8 bytes, appears here.'),
      )
      flags.replaceChildren()
      status.textContent = ''
    }

    function update() {
      const value = input.value
      if (value === '') {
        emptyState()
        return
      }

      const totals = summarise(value)
      summary.replaceChildren(
        stat({ label: 'Code points', value: String(totals.codePoints), hint: 'Unicode values' }),
        stat({ label: 'Graphemes', value: String(totals.graphemes), hint: 'what a reader sees' }),
        stat({ label: 'UTF-16 units', value: String(totals.utf16Units), hint: 'JavaScript .length' }),
        stat({ label: 'UTF-8 bytes', value: String(totals.utf8Bytes), hint: 'bytes on the wire' }),
        stat({
          label: 'ASCII / other',
          value: `${totals.ascii} / ${totals.nonAscii}`,
          hint: 'code points below 128',
        }),
      )

      flags.replaceChildren(
        ...(totals.loneSurrogates
          ? [
              note(
                `${totals.loneSurrogates} unpaired surrogate code unit${totals.loneSurrogates === 1 ? '' : 's'} — the text is not well-formed Unicode. The UTF-8 count below assumes each is replaced with U+FFFD (3 bytes).`,
                'warn',
              ),
            ]
          : []),
      )

      const infos = inspect(value, ROW_LIMIT)
      const body = charTable.querySelector('tbody')
      if (body) body.replaceChildren(...infos.map(row))
      codePoints.replaceChildren(
        charTable,
        infos.length < totals.codePoints
          ? note(`Showing the first ${ROW_LIMIT} of ${totals.codePoints} characters.`)
          : el('span'),
      )

      const encoded = encodeHtml(value)
      const decoded = decodeHtml(value)
      encodeOut.setValue(encoded)
      decodeOut.setValue(decoded)
      encodeOut.setMeta(encoded === value ? 'nothing to escape' : `${encoded.length} characters`)
      decodeOut.setMeta(decoded === value ? 'nothing to decode' : `${decoded.length} characters`)
      status.textContent =
        `${totals.codePoints} code point${totals.codePoints === 1 ? '' : 's'}, ` +
        `${totals.graphemes} grapheme${totals.graphemes === 1 ? '' : 's'}, ` +
        `${totals.utf8Bytes} UTF-8 byte${totals.utf8Bytes === 1 ? '' : 's'}.` +
        (totals.unprintable
          ? ` ${totals.unprintable} character${totals.unprintable === 1 ? '' : 's'} with no visible width.`
          : '') +
        (totals.loneSurrogates
          ? ` ${totals.loneSurrogates} unpaired surrogate code unit${totals.loneSurrogates === 1 ? '' : 's'}; the text is not well-formed Unicode.`
          : '')
    }

    const loadSample = button('Load example', {
      icon: 'refresh',
      onClick: () => {
        input.value = SAMPLE
        update()
        input.focus()
      },
    })
    const clear = button('Clear', {
      icon: 'eraser',
      variant: 'ghost',
      onClick: () => {
        input.value = ''
        update()
        input.focus()
      },
    })

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Text', icon: 'text' },
          field(input, { label: 'Text to inspect', forId: input.id }),
          actions(loadSample, clear, copyButton(() => encodeHtml(input.value), { label: 'Copy encoded', size: 'sm' })),
          status,
        ),
        panel({ title: 'Totals', icon: 'chart' }, summary, flags),
        split(encodeOut, decodeOut),
        codePointPanel,
        note(
          'Encode escapes only the characters that break HTML. Decode understands named references like &copy; and numeric ones like &#169; or &#xA9;, and leaves anything invalid exactly as you typed it.',
        ),
      ),
    )

    update()
  },
}

export default tool

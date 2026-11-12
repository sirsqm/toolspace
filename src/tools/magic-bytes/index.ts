import {
  actions,
  badge,
  cards,
  card,
  checkbox,
  chips,
  copyButton,
  dropzone,
  field,
  note,
  outputBlock,
  panel,
  segmented,
  table,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  classify,
  detect,
  DUMP_LIMIT,
  formatBytes,
  formatDump,
  hexDump,
  parseHex,
  parseText,
  signatureFields,
  SIGNATURES,
  toHex,
  byteOrderMark,
  type Match,
  type Signature,
} from './magic'

const SAMPLE_HEX = '89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52'
const SAMPLE_TEXT = '%PDF-1.7\n% toolspace sample'

const tool: Tool = {
  slug: 'magic-bytes',
  name: 'Magic Bytes Detector',
  description: 'Identify a file type from its leading bytes, or inspect a file header.',
  category: 'Media',
  keywords: ['magic bytes', 'file type', 'signature', 'mime', 'header', 'hex', 'detect', 'file signature'],
  render(root) {
    let mode: 'hex' | 'text' = 'hex'
    let limitDump = true

    const input = textarea({ rows: 3, value: SAMPLE_HEX, onInput: () => runInput() })
    const error = note('', 'danger')
    error.hidden = true
    const status = el('p', { class: 'ts-mb-sr', role: 'status', 'aria-live': 'polite' })
    const verdict = el('div', { class: 'ts-k-actions' })
    const summary = el('div', { class: 'ts-mb-summary' })
    const list = cards()
    const empty = note('Paste hex, type text, or drop a file to read its leading bytes.')
    const results = el('div', { class: 'ts-mb-results' }, empty, verdict, summary, list)

    const ascii = outputBlock('', { label: 'As ASCII' })
    const dump = outputBlock('', {
      label: 'Hex dump',
      copy: () => formatDump(lastBytes, limitDump ? DUMP_LIMIT : lastBytes.length),
    })
    const dumpBody = el('div', { class: 'ts-mb-dump ts-k-mono' })
    dump.setValue(dumpBody)

    let lastBytes: Uint8Array = new Uint8Array()

    function matchCard(match: Match, signature?: Signature) {
      const rows: Record<string, string | Node>[] = [
        { field: 'MIME type', value: match.mime },
        { field: 'Extension', value: match.extension ? `.${match.extension}` : 'none' },
        { field: 'Signature', value: `${match.confidence} byte${match.confidence === 1 ? '' : 's'} pinned at offset ${match.offset}` },
      ]
      if (signature) {
        for (const f of signatureFields(signature)) {
          rows.push({ field: `Offset ${f.offset}`, value: el('code', {}, f.pattern) })
        }
      }
      return card(
        { title: match.name, meta: signature?.text ? 'text' : 'binary', metaTone: signature?.text ? 'accent' : 'neutral' },
        table([{ key: 'field', label: 'Property' }, { key: 'value', label: 'Value', mono: true }], rows),
        actions(
          copyButton(match.mime, { label: 'Copy MIME', size: 'sm' }),
          ...(match.extension ? [copyButton(`.${match.extension}`, { label: 'Copy extension', size: 'sm' })] : []),
        ),
      )
    }

    function renderDump(bytes: Uint8Array) {
      const shown = limitDump ? Math.min(bytes.length, DUMP_LIMIT) : bytes.length
      const lines = hexDump(bytes, limitDump ? DUMP_LIMIT : bytes.length)
      dumpBody.replaceChildren(
        ...lines.map((line) =>
          el(
            'div',
            { class: 'ts-mb-dump__line' },
            el('span', { class: 'ts-mb-dump__off' }, line.offset.toString(16).padStart(8, '0')),
            el('span', { class: 'ts-mb-dump__hex' }, line.hex),
            el('span', { class: 'ts-mb-dump__ascii' }, line.ascii),
          ),
        ),
      )
      dump.setMeta(`${formatBytes(shown)} of ${formatBytes(bytes.length)}`)
    }

    function run(bytes: Uint8Array) {
      lastBytes = bytes
      error.hidden = true
      verdict.replaceChildren()
      summary.replaceChildren()
      list.replaceChildren()
      ascii.body.replaceChildren()
      ascii.setMeta('')

      const kind = classify(bytes)
      if (kind === 'empty') {
        results.replaceChildren(empty)
        empty.hidden = false
        dumpBody.replaceChildren()
        dump.setMeta('')
        status.textContent = 'Waiting for input.'
        return
      }

      results.replaceChildren(verdict, summary, list)
      const matches = detect(bytes)
      const bom = byteOrderMark(bytes)
      const best = matches[0]?.name ?? (kind === 'text' ? 'Plain text' : 'Unknown')

      verdict.append(
        badge(best, matches.length ? 'accent' : 'neutral'),
        badge(kind === 'text' ? 'looks like text' : 'looks binary', 'neutral'),
      )
      summary.append(
        note(
          `${formatBytes(bytes.length)} read · ${matches.length} signature${matches.length === 1 ? '' : 's'} matched` +
            (bom ? ` · byte-order mark: ${bom}` : ''),
        ),
      )

      if (matches.length === 0) {
        list.append(note('No known signature matched these bytes. The hex dump below is still shown so you can inspect the header by hand.'))
      }
      for (const match of matches) {
        const signature = SIGNATURES.find((s) => s.name === match.name)
        list.append(matchCard(match, signature))
      }

      const preview = bytes.subarray(0, 256)
      ascii.body.replaceChildren(
        [...preview].map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·')).join(''),
      )
      ascii.setMeta(`${preview.length} of ${bytes.length} bytes`)
      renderDump(bytes)
      status.textContent = `${best}. ${matches.length} signature match${matches.length === 1 ? '' : 'es'}. ${formatBytes(bytes.length)} read.`
    }

    function runInput() {
      try {
        run(mode === 'hex' ? parseHex(input.value) : parseText(input.value))
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : 'Could not read that input.'
        error.hidden = false
      }
    }

    const modeControl = segmented({
      label: 'Input format',
      value: 'hex',
      items: [
        { label: 'Hex bytes', value: 'hex', hint: '89 50 4e 47' },
        { label: 'Text', value: 'text', hint: 'file contents' },
      ],
      onChange: (value) => {
        mode = value as 'hex' | 'text'
        input.value = mode === 'hex' ? SAMPLE_HEX : SAMPLE_TEXT
        runInput()
      },
    })

    const examples = chips(
      [
        { label: 'PNG', value: '89504e470d0a1a0a' },
        { label: 'PDF', value: '25504446' },
        { label: 'ZIP', value: '504b0304' },
        { label: 'JPEG', value: 'ffd8ff' },
        { label: 'GZIP', value: '1f8b08' },
      ].map((example) => ({
        label: example.label,
        title: `Load ${example.label} header bytes`,
        onClick: () => {
          mode = 'hex'
          modeControl.setValue('hex')
          input.value = example.value.replace(/(..)/g, '$1 ').trim()
          runInput()
        },
      })),
    )

    const dumpLimit = checkbox({
      label: 'Limit dump to the first 512 bytes',
      hint: '(uncheck to dump everything you pasted)',
      checked: true,
      onChange: (checked) => {
        limitDump = checked
        renderDump(lastBytes)
      },
    })

    const drop = dropzone({
      label: 'Drop a file to read its header',
      hint: 'or',
      icon: 'file',
      readAs: 'buffer',
      onFiles: () => {},
      onBuffers: (buffers) => {
        const head = new Uint8Array(buffers[0]).subarray(0, DUMP_LIMIT)
        mode = 'hex'
        modeControl.setValue('hex')
        input.value = toHex(head, 64)
        run(head)
      },
    })

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Leading bytes', icon: 'hash' },
          modeControl,
          field(input, { label: 'Input' }),
          el('div', { class: 'ts-mb-examples' }, el('span', { class: 'ts-k-hint' }, 'Try'), examples),
          drop.root,
          error,
        ),
        panel({ title: 'Detected', icon: 'search' }, status, results),
        panel(
          { title: 'Header', icon: 'code' },
          ascii,
          dump,
          dumpLimit,
        ),
        note('Several formats share a prefix, so every match is listed with the number of bytes its signature pinned down. Nothing you paste or drop leaves the tab.'),
      ),
    )

    runInput()
  },
}

export default tool

import {
  actions,
  button,
  copyRow,
  dropzone,
  field,
  mediaFrame,
  note,
  panel,
  stat,
  stats,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import { download } from '../../core/ui'
import type { Tool } from '../../core/types'
import {
  aspect,
  FIT_TARGETS,
  fitWithin,
  formatBytes,
  inspectImage,
  nearestCommonRatio,
  scaleByPercent,
  type ImageDimensions,
} from './size'

const tool: Tool = {
  slug: 'image-size',
  name: 'Image Size Inspector',
  description: 'Read the dimensions and format of an image without uploading it.',
  category: 'Media',
  keywords: ['image', 'size', 'dimensions', 'width', 'height', 'aspect ratio', 'png', 'jpeg', 'webp', 'metadata'],
  render(root) {
    let current: { info: ImageDimensions; bytes: number; name: string } | null = null

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    // One sentence that a screen reader hears when the answer changes, so the
    // stat strip and the detail list are not read out one row at a time.
    const status = el('p', { class: 'ts-imagesize-sr', role: 'status', 'aria-live': 'polite' })

    const details = el('div', { class: 'ts-k-kvlist' })
    const fits = el('div', { class: 'ts-k-grid' })
    const frame = mediaFrame({ alt: 'Selected image', maxHeight: 260 })
    const caption = el('p', { class: 'ts-k-media__caption' })
    const figures = stats()

    const scale = textField({ value: '50', type: 'number', mono: true, onInput: () => runScale() })
    // A real <label for> needs a real id; the kit only links them when given one.
    scale.id = 'ts-imagesize-scale'
    scale.min = '1'
    scale.step = 'any'
    const scaleOut = el('div', { class: 'ts-k-kvlist' })

    const previewPanel = panel({ title: 'Preview', icon: 'image' }, frame.root, caption)
    const detailPanel = panel({ title: 'Details', icon: 'ruler' }, details)
    const fitPanel = panel(
      { title: 'Fit inside a box', icon: 'ruler' },
      note('The size to resize to so the whole image fits inside each box, keeping its shape. An image already inside a box is left as it is.'),
      fits,
    )
    const scalePanel = panel(
      { title: 'Resize by percentage', icon: 'sliders' },
      field(scale, {
        label: 'Scale (%)',
        forId: 'ts-imagesize-scale',
        hint: 'The size to ask a resizer for. Nothing here changes the file.',
      }),
      scaleOut,
    )

    const report = button('Download report', {
      icon: 'download',
      onClick: () => download('image-info.txt', buildReport()),
    })
    const reportRow = actions(report)

    const resultRow = el('div', { class: 'ts-k-split' })
    resultRow.append(previewPanel, detailPanel)

    const picker = dropzone({
      label: 'Drop an image here',
      hint: 'PNG, JPEG, GIF, WebP, BMP, ICO, TIFF or AVIF',
      accept: 'image/*',
      icon: 'image',
      onFiles: () => {},
      onBuffers: ([buffer], files) => load(buffer, files[0]),
    })

    /** The blocks that only mean something once a file has been read. */
    const resultNodes = [figures, resultRow, fitPanel, scalePanel, reportRow]
    // Kit containers set `display`, which beats the UA `[hidden]` rule, so the
    // tool.css marker class carries the hide for them.
    for (const node of resultNodes) node.classList.add('ts-imagesize-result')

    function showResults(visible: boolean) {
      for (const node of resultNodes) node.hidden = !visible
    }

    function buildReport(): string {
      if (!current) return ''
      const lines = [...details.querySelectorAll('.ts-k-kv')].map((row) => {
        const label = row.querySelector('.ts-k-kv__label')?.textContent ?? ''
        const value = row.querySelector('.ts-k-kv__value')?.textContent ?? ''
        return `${label}: ${value}`
      })
      return [`File: ${current.name}`, ...lines].join('\n')
    }

    function runScale() {
      scaleOut.replaceChildren()
      if (!current) return
      const percent = Number(scale.value)
      if (!scale.value.trim() || !Number.isFinite(percent) || percent <= 0) {
        scaleOut.replaceChildren(copyRow('Result', 'Enter a percentage above zero', { copy: false }))
        return
      }
      if (percent > 1000) {
        scaleOut.replaceChildren(copyRow('Result', 'Enter a percentage of 1000 or less', { copy: false }))
        return
      }
      const size = scaleByPercent(current.info.width, current.info.height, percent)
      scaleOut.replaceChildren(
        copyRow('Scaled size', `${size.width} × ${size.height} px`),
        copyRow('Scaled megapixels', ((size.width * size.height) / 1_000_000).toFixed(2)),
      )
    }

    function load(buffer: ArrayBuffer, selected: File) {
      error.hidden = true
      showResults(false)
      status.textContent = ''
      current = null
      const data = new Uint8Array(buffer)
      const read = inspectImage(data)

      if (!read.ok) {
        error.replaceChildren(el('strong', {}, read.problem.reason), el('span', {}, ` ${read.problem.hint}`))
        error.hidden = false
        status.textContent = `${read.problem.reason} ${read.problem.hint}`
        return
      }

      const info = read.info
      const bytes = data.length
      const ratio = aspect(info.width, info.height)
      const common = nearestCommonRatio(info.width, info.height)
      const fileSize = formatBytes(bytes)

      current = { info, bytes, name: selected.name }

      const rows: [string, string][] = [
        ['File name', selected.name],
        ['Width', `${info.width} px`],
        ['Height', `${info.height} px`],
        ['Format', info.format],
        ['MIME type', info.mime],
        ['Aspect ratio', ratio.ratio],
        ['Aspect (decimal)', ratio.decimal.toFixed(4)],
        ['Orientation', ratio.orientation],
        ['Megapixels', ratio.megapixels.toFixed(2)],
        ['File size', fileSize],
        ['Bytes per pixel', (bytes / (info.width * info.height)).toFixed(2)],
      ]
      if (common) rows.push(['Nearest common shape', `${common.label} — ${common.width} × ${common.height} px`])
      details.replaceChildren(...rows.map(([label, value]) => copyRow(label, value)))

      figures.replaceChildren(
        stat({ label: 'Width', value: `${info.width}px` }),
        stat({ label: 'Height', value: `${info.height}px` }),
        stat({ label: 'Aspect ratio', value: ratio.ratio, hint: common ? `near ${common.label}` : ratio.orientation }),
        stat({ label: 'Megapixels', value: ratio.megapixels.toFixed(2) }),
        stat({ label: 'File size', value: fileSize }),
      )

      frame.image.alt = `Preview of ${selected.name}, ${info.width} by ${info.height} pixels`
      frame.image.src = URL.createObjectURL(selected)
      frame.image.onload = () => URL.revokeObjectURL(frame.image.src)
      caption.textContent = `${selected.name} · ${info.format} · ${fileSize}`

      fits.replaceChildren(
        ...FIT_TARGETS.map(({ label, width, height }) => {
          const fit = fitWithin(info.width, info.height, width, height)
          const card = stat({ label, value: `${fit.width} × ${fit.height}`, hint: `inside ${width} × ${height}` })
          card.classList.add('ts-k-stat--box', 'ts-imagesize-fit')
          return card
        }),
      )

      showResults(true)
      runScale()
      status.textContent = `${selected.name}: ${info.format}, ${info.width} by ${info.height} pixels, aspect ratio ${ratio.ratio}, ${fileSize}.`
    }

    root.append(
      toolLayout(
        { wide: true },
        panel({ title: 'Choose an image', icon: 'uploadCloud' }, picker.root, error),
        status,
        figures,
        resultRow,
        fitPanel,
        scalePanel,
        reportRow,
        note('Only the file header is read, and nothing leaves the browser. Dimensions come from the format header, not from decoding the image.'),
      ),
    )

    showResults(false)
  },
}

export default tool

import {
  actions,
  badge,
  copyRow,
  field,
  kvList,
  note,
  panel,
  slider,
  toolLayout,
  colorField,
  type Tone,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  composite,
  contrastVerdict,
  evaluateContrast,
  formatHex,
  formatHsl,
  formatRgba,
  parseColorWithAlpha,
  rgbToHsl,
  toHex,
  type ContrastResult,
  type Rgb,
  type Rgba,
} from './color'

const DEFAULT = '#4f8cff'
const DEFAULT_BG = '#0e1116'
const ACCEPTED = '#4f8cff, rgb(79 140 255), hsl(217 100% 65%) or rgba(79 140 255 / 0.5)'

const tool: Tool = {
  slug: 'color-converter',
  name: 'Color Converter & Contrast',
  description: 'Convert between HEX, RGB and HSL, and check WCAG contrast for text.',
  category: 'Design',
  keywords: ['color', 'colour', 'hex', 'rgb', 'hsl', 'contrast', 'wcag', 'a11y', 'accessibility', 'alpha', 'transparency'],
  render(root) {

    const fg = colorField({
      value: DEFAULT,
      label: 'Foreground colour',
      text: true,
      onInput: (value) => {
        fg.hex.value = value
        update()
      },
    })

    const bg = colorField({
      value: DEFAULT_BG,
      label: 'Background colour',
      text: true,
      onInput: (value) => {
        bg.hex.value = value
        update()
      },
    })

    // colorField wires the swatch and the text box together but the text box
    // gets no programmatic name of its own, so give it one.
    fg.hex.setAttribute('aria-label', 'Foreground colour value')
    bg.hex.setAttribute('aria-label', 'Background colour value')

    const swatch = el('div', { class: 'ts-color-swatch', role: 'img', 'aria-label': 'Colour preview' })
    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    const srStatus = el('p', { class: 'ts-color-sr', role: 'status', 'aria-live': 'polite' })

    const rows = kvList()
    const formats = panel({ title: 'Formats', icon: 'code' }, rows)
    const empty = note(
      `Enter a colour above — ${ACCEPTED} — to see it converted.`,
      'neutral',
    )

    const ratio = badge('—')
    const verdict = el('p', { class: 'ts-color-verdict' })
    const sample = el('div', { class: 'ts-color-sample' }, 'Sample text at 16px')
    const checks = el('div', { class: 'ts-color-checks' })

    // R, G, B and alpha each get a slider; the sliders are the only way to nudge
    // a channel by hand without retyping the whole value.
    const channelKeys = ['r', 'g', 'b', 'a'] as const
    type ChannelKey = (typeof channelKeys)[number]
    const sliders: Record<ChannelKey, { range: HTMLInputElement; readout: HTMLElement }> = {} as never

    const channelBlock = el(
      'div',
      { class: 'ts-color-sliders' },
      ...channelKeys.map((key) => {
        const control = slider({
          label: key === 'a' ? 'Alpha' : key.toUpperCase(),
          min: 0,
          max: key === 'a' ? 100 : 255,
          value: key === 'a' ? 100 : 0,
          format: (value) => (key === 'a' ? `${Math.round((value / 100) * 100)}%` : String(value)),
          onInput: () => {
            const rgba: Rgba = {
              r: Number(sliders.r.range.value),
              g: Number(sliders.g.range.value),
              b: Number(sliders.b.range.value),
              a: Number(sliders.a.range.value) / 100,
            }
            fg.hex.value = formatHex(rgba)
            update()
          },
        })
        sliders[key] = {
          range: control.querySelector('input') as HTMLInputElement,
          readout: control.querySelector('.ts-k-slider__value') as HTMLElement,
        }
        return control
      }),
    )

    function syncSliders(rgba: Rgba) {
      const values: Record<ChannelKey, number> = { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a * 100 }
      for (const key of channelKeys) {
        const max = key === 'a' ? 100 : 255
        const rounded = Math.round(values[key])
        sliders[key].range.value = String(rounded)
        sliders[key].readout.textContent = key === 'a' ? `${Math.round((rounded / 100) * 100)}%` : String(rounded)
        sliders[key].range.max = String(max)
      }
    }

    function check(label: string, ok: boolean) {
      return el(
        'div',
        { class: 'ts-color-check' },
        el('span', { class: ok ? 'ts-color-dot ts-color-dot--pass' : 'ts-color-dot ts-color-dot--fail', 'aria-hidden': 'true' }, ok ? '✓' : '✕'),
        el('span', {}, label),
        el('span', { class: 'ts-color-check__state' }, ok ? 'Pass' : 'Fail'),
      )
    }

    function renderContrast(foreground: Rgba, background: Rgb) {
      // A translucent foreground is painted over the background first, so the
      // ratio matches what the eye actually sees.
      const flat = composite(foreground, background)
      const result: ContrastResult = evaluateContrast(flat, background)
      const value = result.ratio.toFixed(2)
      ratio.textContent = `${value}:1`
      const tone: Tone = result.aaNormal ? 'ok' : result.aaLarge ? 'warn' : 'danger'
      ratio.className = `ts-k-badge ts-k-badge--${tone}`
      verdict.textContent = contrastVerdict(result)
      verdict.className = `ts-color-verdict is-${tone}`
      sample.style.color = toHex(flat)
      sample.style.background = toHex(background)
      swatch.style.background = toHex(background)
      swatch.style.borderColor = toHex(flat)

      checks.replaceChildren(
        check('AA · normal text (4.5:1)', result.aaNormal),
        check('AA · large text (3:1)', result.aaLarge),
        check('AAA · normal text (7:1)', result.aaaNormal),
        check('AAA · large text (4.5:1)', result.aaaLarge),
      )
      return result
    }

    function update() {
      const parsed = parseColorWithAlpha(fg.hex.value)
      const bgRgb = parseColorWithAlpha(bg.hex.value)

      if (!parsed) {
        swatch.style.background = 'transparent'
        swatch.style.borderColor = 'var(--border)'
        rows.replaceChildren()
        formats.hidden = true
        empty.hidden = false
        error.textContent = fg.hex.value.trim() ? `Not a colour. Try ${ACCEPTED}.` : ''
        error.hidden = !fg.hex.value.trim()
        srStatus.textContent = fg.hex.value.trim() ? error.textContent : 'Enter a colour to convert.'
        return
      }

      error.hidden = true
      empty.hidden = true
      formats.hidden = false
      syncSliders(parsed)
      const hsl = rgbToHsl(parsed)

      rows.replaceChildren(
        copyRow('HEX', formatHex(parsed)),
        copyRow('RGB', formatRgba(parsed)),
        copyRow('HSL', formatHsl(hsl)),
      )

      if (!bgRgb) {
        error.textContent = `Background is not a colour. Try ${ACCEPTED}.`
        error.hidden = false
        ratio.textContent = '—'
        ratio.className = 'ts-k-badge ts-k-badge--neutral'
        verdict.textContent = 'Enter a background colour to check contrast.'
        verdict.className = 'ts-color-verdict'
        checks.replaceChildren()
        sample.style.color = ''
        sample.style.background = ''
        srStatus.textContent = error.textContent
        return
      }

      const result = renderContrast(parsed, bgRgb)
      srStatus.textContent = `Contrast ${result.ratio.toFixed(2)} to 1. ${contrastVerdict(result)}`
    }

    root.append(
      toolLayout(
        {},
        panel(
          { title: 'Colour', icon: 'palette' },
          el('div', { class: 'ts-color-top' }, swatch, el('div', { class: 'ts-color-top__field' }, fg.root)),
          error,
          field(channelBlock, { label: 'Channels' }),
        ),
        empty,
        formats,
        panel(
          { title: 'Contrast check', icon: 'eye' },
          bg.root,
          actions(el('span', { class: 'ts-k-hint' }, 'Contrast ratio'), ratio),
          sample,
          verdict,
          checks,
        ),
        srStatus,
        note('Alpha is composited onto the background before the ratio is measured, matching how a browser paints a translucent colour.'),
      ),
    )

    update()
  },
}

export default tool

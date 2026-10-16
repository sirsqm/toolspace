import {
  actions,
  badge,
  button,
  colorField,
  copyRow,
  kvList,
  meter,
  note,
  panel,
  segmented,
  toolLayout,
  type Tone,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  bestTextColor,
  flattenPair,
  parseColor,
  peakContrast,
  report,
  suggestions,
  toHex,
  toHslString,
  toRgbString,
  verdictSentence,
  type Rgba,
} from './color'

const DEFAULT_FG = '#777777'
const DEFAULT_BG = '#ffffff'

/** The three WCAG targets a reader actually asks for, in ascending strength. */
const TARGETS = [
  { value: '3', label: 'Large text', hint: '3:1' },
  { value: '4.5', label: 'Body text', hint: '4.5:1' },
  { value: '7', label: 'AAA', hint: '7:1' },
]

const tool: Tool = {
  slug: 'color-contrast',
  name: 'Colour Contrast Checker',
  description: 'Check WCAG contrast between two colours and get a colour that passes.',
  category: 'Design',
  keywords: ['colour', 'color', 'contrast', 'wcag', 'accessibility', 'a11y', 'hex', 'hsl', 'luminance'],
  render(root) {
    let foreground = parseColor(DEFAULT_FG)
    let background = parseColor(DEFAULT_BG)
    let target = 4.5

    const fg = colorField({
      value: DEFAULT_FG,
      label: 'Foreground',
      text: true,
      onInput: (value) => handleInput('foreground', value, fg.hex),
    })
    const bg = colorField({
      value: DEFAULT_BG,
      label: 'Background',
      text: true,
      onInput: (value) => handleInput('background', value, bg.hex),
    })

    // These boxes accept any CSS colour here, so each needs its own accessible
    // name rather than relying on the visible row label.
    fg.hex.setAttribute('aria-label', 'Foreground colour, any CSS format')
    bg.hex.setAttribute('aria-label', 'Background colour, any CSS format')
    fg.hex.classList.add('ts-contrast-field')
    bg.hex.classList.add('ts-contrast-field')
    fg.hex.placeholder = '#777777, rgb(…), hsl(…)'
    bg.hex.placeholder = '#ffffff, rgb(…), hsl(…)'

    const ratio = el('span', { class: 'ts-contrast-ratio ts-k-mono' })
    const ratioMeter = meter()
    // The bar is decorative: the ratio text and the live region carry the same
    // answer, so a screen reader should not hear a bare progress bar as well.
    ratioMeter.root.classList.add('ts-contrast-meter')
    ratioMeter.root.setAttribute('aria-hidden', 'true')
    const verdict = el('div', { class: 'ts-k-actions' })
    const sentence = el('p', { class: 'ts-contrast-sentence' })
    // When a field is mid-edit and unreadable, the figures still describe the
    // last valid pair. Say so rather than let the stale ratio look current.
    const stale = el('p', { class: 'ts-contrast-sentence ts-contrast-stale' })
    stale.textContent = 'Showing the last readable pair; fix the highlighted field to update.'
    stale.hidden = true
    const preview = el(
      'div',
      { class: 'ts-contrast-preview' },
      el('p', { class: 'ts-contrast-large' }, 'Large text, 24px'),
      el('p', {}, 'Normal body text at the default size'),
      el('p', { class: 'ts-contrast-small' }, 'Small helper text, 12px'),
    )
    const rows = kvList()
    const error = note('', 'danger')
    error.hidden = true
    error.id = 'ts-contrast-error'
    // An invalid colour is announced as it appears, not just shown.
    error.setAttribute('role', 'alert')
    fg.hex.setAttribute('aria-describedby', error.id)
    bg.hex.setAttribute('aria-describedby', error.id)
    const suggestionsBox = el('div', { class: 'ts-k-actions ts-contrast-suggestions' })
    const targetControl = segmented({
      label: 'Contrast target',
      items: TARGETS,
      value: '4.5',
      onChange: (value) => {
        target = Number(value)
        run()
      },
    })
    targetControl.classList.add('ts-contrast-target')

    // Screen readers get one line whenever the answer changes; the visible
    // panels carry the same information, so they stay out of the live region.
    const sr = el('p', { class: 'ts-contrast-sr', role: 'status', 'aria-live': 'polite' })

    // Each field keeps its own message so one field's fix cannot hide the
    // other's remaining error; the shared alert shows whatever is still wrong.
    const fieldError: { foreground: string | null; background: string | null } = {
      foreground: null,
      background: null,
    }

    function showErrors() {
      const messages = (['foreground', 'background'] as const)
        .map((which) => fieldError[which])
        .filter((message): message is string => message !== null)
      if (messages.length === 0) {
        error.hidden = true
        stale.hidden = true
        return
      }
      // Both fields share one alert, so an error in the other field cannot be
      // cleared by fixing this one.
      error.textContent = messages.join(' ')
      error.hidden = false
      stale.hidden = false
    }

    function handleInput(which: 'foreground' | 'background', value: string, input: HTMLInputElement) {
      try {
        const color = parseColor(value)
        if (which === 'foreground') foreground = color
        else background = color
        input.setAttribute('aria-invalid', 'false')
        fieldError[which] = null
        showErrors()
        run()
      } catch (err) {
        input.setAttribute('aria-invalid', 'true')
        const label = which === 'foreground' ? 'Foreground' : 'Background'
        fieldError[which] = `${label}: ${err instanceof Error ? err.message : 'could not read that colour.'}`
        showErrors()
      }
    }

    function setColors(nextForeground: Rgba, nextBackground: Rgba) {
      foreground = nextForeground
      background = nextBackground
      fg.hex.value = toHex(foreground)
      fg.swatch.value = toHex(foreground)
      bg.hex.value = toHex(background)
      bg.swatch.value = toHex(background)
      fg.hex.setAttribute('aria-invalid', 'false')
      bg.hex.setAttribute('aria-invalid', 'false')
      fieldError.foreground = null
      fieldError.background = null
      showErrors()
      run()
    }

    function run() {
      const result = report(foreground, background)
      ratio.textContent = `${result.ratio.toFixed(2)}:1`
      ratioMeter.set(
        result.aaaPass ? 4 : result.normalPass ? 3 : result.largePass ? 2 : 1,
        (result.ratio - 1) / 20,
      )

      const tone = (pass: boolean): Tone => (pass ? 'ok' : 'danger')
      verdict.replaceChildren(
        badge(`AA normal ${result.normalPass ? 'pass' : 'fail'}`, tone(result.normalPass)),
        badge(`AA large ${result.largePass ? 'pass' : 'fail'}`, tone(result.largePass)),
        badge(`AAA ${result.aaaPass ? 'pass' : 'fail'}`, tone(result.aaaPass)),
      )
      sentence.textContent = verdictSentence(result)

      preview.style.color = toHex(foreground)
      preview.style.background = toHex(background)

      const best = bestTextColor(background)
      rows.replaceChildren(
        copyRow('Foreground', `${toHex(foreground)} · ${toRgbString(foreground)} · ${toHslString(foreground)}`),
        copyRow('Background', `${toHex(background)} · ${toRgbString(background)} · ${toHslString(background)}`),
        copyRow('Contrast', `${result.ratio.toFixed(2)}:1`),
        copyRow('Best match', `${toHex(best)} · ${flattenPair(best, background).toFixed(2)}:1`),
      )

      const passing = suggestions(foreground, background, target)
      if (passing.length > 0) {
        suggestionsBox.replaceChildren(
          ...passing.map((item, index) =>
            button(`${item.label} ${toHex(item.color)} · ${item.ratio.toFixed(2)}:1`, {
              size: 'sm',
              variant: index === 0 && item.label === 'Closest passing' ? 'primary' : 'default',
              title: `Use ${toHex(item.color)} as the foreground`,
              onClick: () => {
                foreground = item.color
                fg.hex.value = toHex(item.color)
                fg.swatch.value = toHex(item.color)
                fg.hex.setAttribute('aria-invalid', 'false')
                fieldError.foreground = null
                showErrors()
                run()
              },
            }),
          ),
        )
      } else {
        // The target is unreachable for this background, so no colour can be
        // offered. Say so with the ceiling instead of showing a blank panel.
        const ceiling = peakContrast(background)
        suggestionsBox.replaceChildren(
          note(
            `No foreground reaches ${target}:1 on ${toHex(background)}. Its ceiling is ${ceiling.toFixed(2)}:1 — pick a different background.`,
            'warn',
          ),
        )
      }

      sr.textContent = `Foreground ${toHex(foreground)} on background ${toHex(background)}: ${verdictSentence(result)}`
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Colours', icon: 'palette' },
          fg.root,
          bg.root,
          actions(
            button('Swap', { icon: 'swap', onClick: () => setColors(background, foreground) }),
            button('Reset', {
              icon: 'refresh',
              onClick: () => setColors(parseColor(DEFAULT_FG), parseColor(DEFAULT_BG)),
            }),
          ),
          error,
        ),
        panel(
          { title: 'Contrast', icon: 'info' },
          el('div', { class: 'ts-k-actions' }, ratio),
          ratioMeter.root,
          verdict,
          sentence,
          stale,
          preview,
        ),
        panel({ title: 'Details', icon: 'list' }, rows),
        panel({ title: 'Suggested foregrounds', icon: 'sparkle' }, targetControl, suggestionsBox),
        sr,
        note(
          'Contrast follows WCAG 2.1, including the linear segment for very dark colours. A translucent colour is flattened onto the page before measuring, so the ratio matches what a reader sees. Either field accepts hex, rgb() or hsl().',
        ),
      ),
    )

    run()
  },
}

export default tool

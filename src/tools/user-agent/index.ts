import {
  actions,
  badge,
  button,
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
  toolLayout,
  type Tone,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import { looksLikeUserAgent, parseUserAgent, SAMPLES, summarize, type DeviceKind } from './useragent'

const DEVICE_LABEL: Record<DeviceKind, string> = {
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  bot: 'Crawler',
  cli: 'Command-line client',
  unknown: 'Unknown',
}

const DEVICE_TONE: Record<DeviceKind, Tone> = {
  desktop: 'neutral',
  mobile: 'accent',
  tablet: 'accent',
  bot: 'warn',
  cli: 'ok',
  unknown: 'neutral',
}

const tool: Tool = {
  slug: 'user-agent',
  name: 'User-Agent Parser',
  description: 'Decode a user-agent string into browser, engine, OS and device type.',
  category: 'Web',
  keywords: ['user agent', 'ua', 'browser', 'detect', 'device', 'parse', 'crawler', 'bot'],
  render(root) {
    const input = textarea({
      rows: 3,
      value: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      placeholder: 'Paste a User-Agent header value, or pick a sample below',
      onInput: () => run(),
    })

    const error = el('p', { class: 'ts-k-note ts-k-note--danger ts-ua-error' })
    error.hidden = true
    error.setAttribute('role', 'alert')

    // One concise sentence per keystroke, announced once rather than once per
    // panel, so a screen reader is not flooded as the user types.
    const status = el('p', { class: 'ts-ua-sr', role: 'status', 'aria-live': 'polite' })

    const intro = el(
      'p',
      { class: 'ts-k-note ts-k-note--neutral ts-ua-empty' },
      'Paste a User-Agent header to see which browser, engine, operating system and device it claims to be. ' +
        'No input ever leaves your browser — try a sample below.',
    )

    const summary = el('p', { class: 'ts-ua-summary' })
    const kindBadge = badge('—')
    const figures = stats()
    const detail = kvList()
    const results = panel(
      { title: 'Parsed', icon: 'check' },
      el('div', { class: 'ts-ua-head' }, summary, kindBadge),
      figures,
      detail,
    )
    results.classList.add('ts-ua-results')
    results.hidden = true

    function setSummary(info: ReturnType<typeof parseUserAgent>) {
      summary.textContent = summarize(info)
      kindBadge.textContent = DEVICE_LABEL[info.device]
      kindBadge.className = `ts-k-badge ts-k-badge--${DEVICE_TONE[info.device]}`
    }

    function run() {
      const raw = input.value
      const trimmed = raw.trim()

      if (!trimmed) {
        intro.hidden = false
        results.hidden = true
        error.hidden = true
        status.textContent = ''
        return
      }

      if (!looksLikeUserAgent(trimmed)) {
        intro.hidden = true
        results.hidden = true
        error.textContent =
          'That does not look like a User-Agent string. It usually contains a product token such as ' +
          '"Mozilla/5.0", "curl/8.0" or "Googlebot/2.1".'
        error.hidden = false
        status.textContent = 'Not a user-agent string.'
        return
      }

      const info = parseUserAgent(trimmed)
      error.hidden = true
      intro.hidden = true
      results.hidden = false
      setSummary(info)

      const deviceValue = info.deviceModel ? `${info.deviceModel} · ${DEVICE_LABEL[info.device]}` : DEVICE_LABEL[info.device]
      figures.replaceChildren(
        stat({ label: info.bot ? 'Crawler' : info.kind === 'cli' ? 'Client' : 'Browser', value: info.browser, hint: info.browserVersion ? `v${info.browserVersion}` : undefined }),
        stat({ label: 'Engine', value: info.engine, hint: info.engineVersion ? `v${info.engineVersion}` : undefined }),
        stat({ label: 'Operating system', value: info.os, hint: info.osVersion || undefined }),
        stat({ label: 'Device', value: deviceValue }),
      )

      const entries: [string, string][] = [
        [info.bot ? 'Crawler' : 'Browser', info.browser],
        ['Version', info.browserVersion || '—'],
        ['Engine', info.engineVersion ? `${info.engine} ${info.engineVersion}` : info.engine],
        ['Operating system', info.osVersion ? `${info.os} ${info.osVersion}` : info.os],
        ['Device type', DEVICE_LABEL[info.device]],
      ]
      if (info.deviceModel) entries.push(['Device model', info.deviceModel])
      if (info.cpu) entries.push(['CPU architecture', info.cpu])
      entries.push(['Is a bot', info.bot ? 'Yes' : 'No'])
      detail.replaceChildren(...entries.map(([label, value]) => copyRow(label, value)))

      status.textContent = summarize(info)
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'User-Agent', icon: 'globe' },
          field(input, { label: 'User-Agent string' }),
          actions(
            button('Use my browser’s UA', {
              icon: 'refresh',
              onClick: () => {
                input.value = typeof navigator !== 'undefined' ? navigator.userAgent : ''
                run()
              },
            }),
            copyButton(() => input.value, { label: 'Copy UA' }),
            button('Clear', {
              icon: 'close',
              onClick: () => {
                input.value = ''
                run()
                input.focus()
              },
            }),
          ),
          error,
        ),
        intro,
        results,
        panel(
          { title: 'Samples', icon: 'list' },
          chips(
            SAMPLES.map((sample) => ({
              label: sample.label,
              value: sample.ua,
              onClick: (value: string) => {
                input.value = value
                run()
              },
            })),
          ),
        ),
        status,
        note('User-Agent strings are self-reported and can be spoofed, so treat this as a hint rather than proof.'),
      ),
    )

    run()
  },
}

export default tool

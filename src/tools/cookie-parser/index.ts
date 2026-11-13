import {
  actions,
  button,
  card,
  cards,
  chips,
  copyButton,
  findings,
  findingRow,
  kvList,
  note,
  outputBlock,
  panel,
  segmented,
  stats,
  stat,
  textarea,
  toolLayout,
  type Tone,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  attributeEntries,
  CookieError,
  EXAMPLES,
  parseCookieHeader,
  parseSetCookie,
  parseSetCookieBlock,
  serialise,
  summarise,
  type ParsedCookie,
} from './cookie'

const LEVEL_TONES: Record<string, Tone> = { error: 'danger', warn: 'warn', info: 'neutral' }
const VERDICT_TONES: Record<string, Tone> = { error: 'danger', warn: 'warn', ok: 'ok' }
const VERDICT_LABELS: Record<string, string> = { error: 'Fails', warn: 'Weak', ok: 'Good' }

/**
 * A pasted block may be one Set-Cookie line, several lines, or a Cookie
 * request header. The first line decides: if it carries a known attribute it is
 * a response cookie; otherwise a single line with no attributes is a request
 * header, which has no flags to audit.
 */
function detectInput(text: string): { mode: 'set-cookie' | 'request'; cookies: ParsedCookie[] } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const firstLine = lines[0] ?? ''
  const hasAttribute = /\b(secure|httponly|samesite|domain|path|max-age|expires|partitioned)\b/i.test(firstLine)
  const isResponse = hasAttribute || lines.length > 1
  if (isResponse) return { mode: 'set-cookie', cookies: lines.map((line) => parseSetCookie(line)) }
  const pairs = parseCookieHeader(text)
  return { mode: 'request', cookies: pairs.map((pair) => parseSetCookie(`${pair.name}=${pair.value}`)) }
}

/** A stat figure whose number is tinted to match how serious it is. */
function tonedStat(label: string, value: number, tone: Tone): HTMLElement {
  const node = stat({ label, value: String(value) })
  node.classList.add(`ts-cookie-stat--${tone}`)
  return node
}

const tool: Tool = {
  slug: 'cookie-parser',
  name: 'Cookie Parser & Security Audit',
  description: 'Parse Set-Cookie and Cookie headers and check the security flags on each cookie.',
  category: 'Security',
  keywords: ['cookie', 'set-cookie', 'http', 'secure', 'httponly', 'samesite', 'audit', 'header'],
  render(root) {
    let inputMode: 'auto' | 'set-cookie' | 'request' = 'auto'
    let report = ''

    const input = textarea({
      rows: 8,
      mono: true,
      placeholder: 'session=abc; Domain=example.com; Path=/; SameSite=Lax; Secure; HttpOnly',
      onInput: () => run(),
    })
    input.id = 'ts-cookie-input'
    input.setAttribute('autocomplete', 'off')

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('role', 'alert')

    // The visible cards carry the answer; this one line is what a screen reader
    // hears, so a keystroke is not announced once per cookie.
    const srStatus = el('p', { class: 'ts-cookie-sr', role: 'status', 'aria-live': 'polite' })

    const modeHint = el('p', { class: 'ts-k-hint' })

    const mode = segmented({
      label: 'Input kind',
      value: inputMode,
      items: [
        { value: 'auto', label: 'Auto' },
        { value: 'set-cookie', label: 'Set-Cookie' },
        { value: 'request', label: 'Request' },
      ],
      onChange: (value) => {
        inputMode = value as typeof inputMode
        run()
      },
    })

    const summary = stats()
    summary.hidden = true

    const output = cards()

    const reportBlock = outputBlock('', { label: 'Audit report', copy: () => report })

    const emptyState = el(
      'div',
      { class: 'ts-cookie-empty' },
        el('p', { class: 'ts-k-hint' }, 'Paste a Set-Cookie line, several lines, or a Cookie request header. Choose how it is read above, or leave it on Auto.'),
    )

    const examples = chips(
      EXAMPLES.map((example) => ({
        label: example.label,
        value: example.value,
        onClick: (value) => {
          input.value = value
          inputMode = 'auto'
          mode.setValue('auto')
          run()
          input.focus()
        },
      })),
    )

    const clearButton = button('Clear', {
      icon: 'eraser',
      variant: 'ghost',
      onClick: () => {
        input.value = ''
        run()
        input.focus()
      },
    })

    function renderCookie(cookie: ParsedCookie, verdict: string): HTMLElement {
      const entries = attributeEntries(cookie)
      return card(
        { title: cookie.name, meta: cookie.expired ? 'expired' : VERDICT_LABELS[verdict], metaTone: cookie.expired ? 'warn' : VERDICT_TONES[verdict] },
        cookie.value
          ? el('div', { class: 'ts-cookie-value' }, el('code', { class: 'ts-k-mono' }, cookie.value))
          : '',
        kvList(
          ...entries.map((entry) =>
            el(
              'div',
              { class: 'ts-k-kv' },
              el('span', { class: 'ts-k-kv__label' }, entry.label),
              el('span', { class: 'ts-k-kv__value ts-k-mono' }, entry.value),
            ),
          ),
        ),
        findings(
          ...(cookie.issues.length
            ? cookie.issues.map((issue) =>
                findingRow({ status: issue.level, tone: LEVEL_TONES[issue.level] ?? 'neutral', name: issue.attribute ?? cookie.name, message: issue.message }),
              )
            : [findingRow({ status: 'ok', tone: 'ok', name: cookie.name, message: 'No problems found.' })]),
        ),
        actions(copyButton(() => serialise(cookie), { label: 'Copy normalised', size: 'sm' })),
      )
    }

    function run() {
      output.replaceChildren()
      summary.replaceChildren()
      summary.hidden = true
      report = ''
      reportBlock.body.replaceChildren('')
      reportBlock.setMeta('')

      const text = input.value.trim()
      if (!text) {
        error.hidden = true
        modeHint.textContent = ''
        output.append(emptyState)
        srStatus.textContent = 'Waiting for a cookie header.'
        return
      }

      try {
        let result: { mode: 'set-cookie' | 'request'; cookies: ParsedCookie[] }
        if (inputMode === 'request') {
          result = { mode: 'request', cookies: parseCookieHeader(text).map((pair) => parseSetCookie(`${pair.name}=${pair.value}`)) }
        } else if (inputMode === 'set-cookie') {
          result = { mode: 'set-cookie', cookies: parseSetCookieBlock(text) }
        } else {
          result = detectInput(text)
        }

        const audit = summarise(result.cookies)
        error.hidden = true
        modeHint.textContent =
          result.mode === 'request'
            ? `Read as a Cookie request header — ${result.cookies.length} name${result.cookies.length === 1 ? '' : 's'}. Request headers carry names and values only, so there are no flags to check.`
            : `Read as ${result.cookies.length} Set-Cookie line${result.cookies.length === 1 ? '' : 's'}.`

        summary.hidden = false
        summary.append(
          stat({ label: 'Cookies', value: String(audit.cookies) }),
          tonedStat('Fails', audit.errors, audit.errors ? 'danger' : 'ok'),
          tonedStat('Warnings', audit.warnings, audit.warnings ? 'warn' : 'ok'),
          stat({ label: 'Notes', value: String(audit.infos) }),
        )

        result.cookies.forEach((cookie, index) => output.append(renderCookie(cookie, audit.perCookie[index])))

        if (result.mode === 'set-cookie') {
          report = result.cookies
            .map((cookie) => `${cookie.name}: ${cookie.issues.length ? cookie.issues.map((i) => `${i.level}: ${i.message}`).join(' | ') : 'ok'}`)
            .join('\n')
          reportBlock.body.replaceChildren(report)
          reportBlock.setMeta(`${audit.errors} fails, ${audit.warnings} warnings`)
        } else {
          reportBlock.body.replaceChildren('Request headers carry names and values only — paste Set-Cookie lines to audit the flags.')
        }

        srStatus.textContent =
          result.mode === 'request'
            ? `${result.cookies.length} request cookies.`
            : `${audit.cookies} cookies: ${audit.errors} fails, ${audit.warnings} warnings, ${audit.infos} notes.`
      } catch (err) {
        error.textContent = err instanceof CookieError ? err.message : 'Could not parse that cookie.'
        error.hidden = false
        modeHint.textContent = ''
        output.append(emptyState)
        srStatus.textContent = 'That cookie could not be parsed.'
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Cookie header', icon: 'code' },
          mode,
          modeHint,
          input,
          error,
          actions(clearButton),
          el('p', { class: 'ts-k-hint' }, 'Try one:'),
          examples,
        ),
        panel({ title: 'Cookies', icon: 'shield' }, summary, output),
        reportBlock,        srStatus,
      ),
    )

    run()
  },
}

export default tool

import {
  card,
  cards,
  copyRow,
  field,
  findingRow,
  findings,
  note,
  panel,
  textarea,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  inspectPrivateKey,
  inspectPublicKey,
  isPrivateKey,
  parseKeyLines,
  SshError,
  type SshKey,
} from './ssh'

/** A pause in typing before reading, so a long paste is parsed once. */
const DEBOUNCE_MS = 150

const EXAMPLE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHoQHKLJFmwFXwAp2U/EUAudoQdwazQqtzbjBOIASzHl you@laptop'

function details(key: SshKey): HTMLElement[] {
  const rows: HTMLElement[] = [copyRow('Type', key.type), copyRow('Algorithm', key.label)]
  if (key.host) rows.push(copyRow('Host', key.host))
  if (key.curve) rows.push(copyRow('Curve', key.curve))
  if (key.bits) rows.push(copyRow('Size', `${key.bits} bits`))
  if (key.comment) rows.push(copyRow('Comment', key.comment))
  if (key.kind === 'private') rows.push(copyRow('Encrypted', key.encrypted ? 'yes' : 'no', { copy: false }))
  rows.push(copyRow('SHA-256 fingerprint', key.fingerprints.sha256))
  rows.push(copyRow('MD5 fingerprint', key.fingerprints.md5))
  return rows
}

function keyCard(key: SshKey, index: number, total: number): HTMLElement {
  const node = card(
    {
      title: key.label,
      meta: key.kind === 'private' ? 'Private key' : 'Public key',
      metaTone: key.kind === 'private' ? 'warn' : 'ok',
    },
    ...details(key),
  )
  if (total > 1) node.querySelector('.ts-k-card__title')?.prepend(el('span', {}, `${index + 1}. `))
  node.body.append(
    findings(
      ...key.checks.map((check) =>
        findingRow({ status: check.status, tone: check.level, name: check.title, message: check.detail }),
      ),
    ),
  )
  return node
}

const tool: Tool = {
  slug: 'ssh-key-inspector',
  name: 'SSH Key Inspector',
  description: 'Read the type, size and fingerprints of an SSH public or OpenSSH private key.',
  category: 'Security',
  keywords: ['ssh', 'key', 'fingerprint', 'ed25519', 'rsa', 'ecdsa', 'authorized_keys', 'known_hosts'],
  render(root) {
    const input = textarea({
      rows: 6,
      placeholder: 'ssh-ed25519 AAAAC3Nza… user@host\n\nor paste an -----BEGIN OPENSSH PRIVATE KEY----- block',
      onInput: () => {
        if (debounce !== undefined) window.clearTimeout(debounce)
        debounce = window.setTimeout(() => void run(), DEBOUNCE_MS)
      },
    })
    input.id = 'ts-ssh-input'

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('role', 'alert')

    const empty = note(
      'Paste a public key line from authorized_keys, a line from known_hosts, or a whole OpenSSH private key. ' +
        'Several keys at once are fine — one is read per line. Nothing leaves this page.',
    )
    const example = note('')
    example.classList.add('ts-ssh-example')
    example.append(el('code', { class: 'ts-k-mono' }, EXAMPLE))

    const status = note('')
    status.classList.add('ts-ssh-status')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    status.hidden = true

    const results = cards()
    results.setAttribute('aria-live', 'polite')

    let debounce: number | undefined
    let token = 0

    async function run() {
      const current = ++token
      results.replaceChildren()
      error.hidden = true
      const units = parseKeyLines(input.value)
      if (units.length === 0) {
        status.hidden = true
        empty.hidden = false
        example.hidden = false
        return
      }
      empty.hidden = true
      example.hidden = true

      const keys: SshKey[] = []
      const failures: string[] = []
      for (const unit of units) {
        try {
          keys.push(isPrivateKey(unit) ? await inspectPrivateKey(unit) : await inspectPublicKey(unit))
        } catch (err) {
          failures.push(err instanceof SshError ? err.message : 'Could not read that SSH key.')
        }
        if (current !== token) return
      }

      if (keys.length === 0) {
        status.hidden = true
        error.textContent = failures[0] ?? 'Could not read that SSH key.'
        error.hidden = false
        return
      }

      results.replaceChildren(...keys.map((key, index) => keyCard(key, index, keys.length)))
      const flagged = keys.filter((key) => key.checks.some((check) => check.level !== 'ok')).length
      status.hidden = false
      status.textContent =
        `Read ${keys.length === 1 ? '1 key' : `${keys.length} keys`}` +
        (flagged ? `; ${flagged} need${flagged === 1 ? 's' : ''} attention.` : '; all look sound.')
      if (failures.length) {
        error.textContent = `${failures.length} line${failures.length === 1 ? '' : 's'} could not be read: ${failures[0]}`
        error.hidden = false
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'SSH key', icon: 'key' },
          field(input, {
            label: 'SSH key',
            forId: 'ts-ssh-input',
            hint: 'Public key lines, known_hosts lines and OpenSSH private keys are all understood.',
          }),
          empty,
          example,
          error,
        ),
        panel({ title: 'Details', icon: 'info' }, status, results),
      ),
    )
  },
}

export default tool

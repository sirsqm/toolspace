import {
  actions,
  badge,
  button,
  copyRow,
  field,
  kvList,
  note,
  outputBlock,
  panel,
  select,
  toolLayout,
  type Tone,
} from '../../core/components'
import { download } from '../../core/ui'
import type { Tool } from '../../core/types'
import { generateKeyPair, type Algorithm, type KeyPair } from './keypair'

const ALGORITHMS: Algorithm[] = ['Ed25519', 'ECDSA-P256', 'ECDSA-P384', 'RSA-2048', 'RSA-4096']
const ALGORITHM_ID = 'keygen-algorithm'

const HINTS: Record<Algorithm, string> = {
  Ed25519: 'Modern default. Small, fast and the safest choice unless a host demands otherwise.',
  'ECDSA-P256': 'Compact and widely accepted, e.g. by GitHub and most cloud providers.',
  'ECDSA-P384': 'A larger NIST curve for hosts that require stronger ECDSA.',
  'RSA-2048': 'The old default; compatible with everything, including very old servers.',
  'RSA-4096': 'Slow to generate and slow to sign, for policies that insist on 4096-bit RSA.',
}

/** Swap a key/value row for a fresh one and return the new node. */
function replaceRow(current: HTMLElement, next: HTMLElement): HTMLElement {
  current.replaceWith(next)
  return next
}

/** `id_ed25519`, `id_rsa`, `id_ecdsa` — the names ssh-keygen would use. */
function fileBase(keyType: string): string {
  if (keyType === 'ssh-ed25519') return 'id_ed25519'
  if (keyType === 'ssh-rsa') return 'id_rsa'
  return 'id_ecdsa'
}

const tool: Tool = {
  slug: 'key-pair-generator',
  name: 'Key Pair Generator',
  description: 'Generate RSA, ECDSA or Ed25519 key pairs and export them as PEM or OpenSSH keys.',
  category: 'Security',
  keywords: ['key pair', 'rsa', 'ecdsa', 'ed25519', 'pem', 'public key', 'private key', 'ssh', 'authorized_keys'],
  render(root) {
    const algorithm = select({
      value: 'Ed25519',
      options: ALGORITHMS.map((value) => ({ value, label: value })),
      onChange: () => void run(),
    })
    algorithm.id = ALGORITHM_ID

    const publicOpenssh = outputBlock('', {
      label: 'Public key (authorized_keys)',
      copy: () => publicOpenssh.body.textContent ?? '',
    })
    const publicPem = outputBlock('', { label: 'Public key (PEM)', copy: () => publicPem.body.textContent ?? '' })
    const privatePem = outputBlock('', { label: 'Private key (PEM)', copy: () => privatePem.body.textContent ?? '' })
    const privateOpenssh = outputBlock('', {
      label: 'Private key (OpenSSH)',
      copy: () => privateOpenssh.body.textContent ?? '',
    })

    // Replaced in place on every run, so the rows must be re-assigned too:
    // `replaceWith` leaves the old reference pointing at a detached node.
    let fingerprint = copyRow('Fingerprint', '—')
    let type = copyRow('Type', '—', { copy: false })
    let size = copyRow('Size', '—', { copy: false })
    const details = kvList(fingerprint, type, size)
    details.hidden = true

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('role', 'alert')

    const status = badge('Starting…', 'neutral')
    // One live sentence for screen readers; the visible badge and the output
    // blocks stay silent so a generation is not announced three times over.
    const live = document.createElement('p')
    live.className = 'ts-keygen-sr'
    live.setAttribute('role', 'status')
    live.setAttribute('aria-live', 'polite')

    const generate = button('Generate new key pair', { icon: 'refresh', variant: 'primary', onClick: () => void run() })
    const hint = note(HINTS[algorithm.value as Algorithm], 'neutral')
    const downloads = actions(note('Generated files appear here.', 'neutral'))

    const results = document.createElement('div')
    results.className = 'ts-keygen-results'
    results.append(details, publicOpenssh, publicPem, privatePem, privateOpenssh)

    function setStatus(text: string, tone: Tone, announcement = text) {
      status.textContent = text
      status.className = `ts-k-badge ts-k-badge--${tone}`
      live.textContent = announcement
    }

    function apply(pair: KeyPair) {
      const base = fileBase(pair.keyType)
      publicOpenssh.body.replaceChildren(pair.publicKeyOpenssh)
      publicPem.body.replaceChildren(pair.publicKeyPem)
      privatePem.body.replaceChildren(pair.privateKeyPem)
      publicOpenssh.setMeta(pair.keyType)
      publicPem.setMeta('SPKI')
      privatePem.setMeta('PKCS#8')

      if (pair.privateKeyOpenssh) {
        privateOpenssh.hidden = false
        privateOpenssh.body.replaceChildren(pair.privateKeyOpenssh)
        privateOpenssh.setMeta('openssh-key-v1')
      } else {
        privateOpenssh.hidden = true
      }

      details.hidden = false
      fingerprint = replaceRow(fingerprint, copyRow('Fingerprint', pair.fingerprint))
      type = replaceRow(type, copyRow('Type', pair.keyType, { copy: false }))
      size = replaceRow(size, copyRow('Size', `${pair.keySummary} · ${pair.bits} bits`, { copy: false }))

      downloads.replaceChildren(
        button(`Download ${base}.pub`, {
          icon: 'download',
          size: 'sm',
          onClick: () => download(`${base}.pub`, `${pair.publicKeyOpenssh}\n`),
        }),
        button(`Download ${base}.pem`, {
          icon: 'download',
          size: 'sm',
          onClick: () => download(`${base}.pem`, `${pair.privateKeyPem}\n`),
        }),
        button(`${base}.pub.pem`, {
          icon: 'download',
          size: 'sm',
          onClick: () => download(`${base}.pub.pem`, `${pair.publicKeyPem}\n`),
        }),
      )
      if (pair.privateKeyOpenssh) {
        downloads.prepend(
          button(`Download ${base}`, {
            icon: 'download',
            size: 'sm',
            onClick: () => download(base, `${pair.privateKeyOpenssh}\n`),
          }),
        )
      }
    }

    async function run() {
      const choice = algorithm.value as Algorithm
      hint.textContent = HINTS[choice]
      generate.disabled = true
      algorithm.disabled = true
      results.setAttribute('aria-busy', 'true')
      setStatus('Generating…', 'warn', `Generating a ${choice} key pair.`)
      error.hidden = true
      try {
        const pair = await generateKeyPair(choice)
        apply(pair)
        setStatus(pair.algorithm, 'ok', `Generated a ${pair.keySummary} key pair, fingerprint ${pair.fingerprint}.`)
      } catch (err) {
        setStatus('Failed', 'danger', 'Key generation failed.')
        error.textContent =
          err instanceof Error
            ? `${err.message} Your browser may not support ${choice}; try another algorithm.`
            : `This browser could not generate a ${choice} key pair. Try another algorithm.`
        error.hidden = false
      } finally {
        generate.disabled = false
        algorithm.disabled = false
        results.removeAttribute('aria-busy')
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        note(
          'Add the public key to the server or service you want to reach: append the authorized_keys line to ' +
            '~/.ssh/authorized_keys, or paste the PEM into a service that asks for a public key.',
          'neutral',
        ),
        panel(
          { title: 'Key pair', icon: 'key' },
          actions(
            field(algorithm, { label: 'Algorithm', forId: ALGORITHM_ID, grow: true }),
            generate,
            status,
          ),
          hint,
          error,
          live,
        ),
        results,
        note(
          'Save the private key with owner-only permissions (chmod 600) and never share it — it is the credential. ' +
            'Anyone who has it can sign in as you.',
          'warn',
        ),
        panel({ title: 'Download', icon: 'download' }, downloads),
      ),
    )

    void run()
  },
}

export default tool

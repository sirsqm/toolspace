import {
  button,
  chips,
  copyRow,
  field,
  kvList,
  note,
  outputBlock,
  panel,
  split,
  stat,
  stats as statStrip,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  approximateCount,
  computeSubnet,
  groupBigInt,
  type SubnetInfo,
} from './cidr'

/** Prefix quick-picks, one set per address family. */
const PREFIXES_V4 = [8, 16, 24, 25, 30, 32]
const PREFIXES_V6 = [32, 48, 56, 64, 112, 128]

const SAMPLE = '192.168.1.10/24'

const tool: Tool = {
  slug: 'cidr',
  name: 'CIDR / Subnet Calculator',
  description: 'Work out network, broadcast, host range and netmask for IPv4 or IPv6 CIDR blocks.',
  category: 'Web',
  keywords: ['cidr', 'subnet', 'netmask', 'ipv4', 'ipv6', 'broadcast', 'network', 'networking'],
  render(root) {
    const input = textField({
      value: SAMPLE,
      mono: true,
      placeholder: '192.168.1.10/24 or 2001:db8::1/48',
      onInput: () => run(),
    })
    input.id = 'ts-cidr-input'
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('spellcheck', 'false')

    const hint = el(
      'p',
      { class: 'ts-k-hint', id: 'ts-cidr-hint' },
      'IPv4 or IPv6. The prefix is optional, and a dotted netmask like /255.255.255.0 works too.',
    )
    input.setAttribute('aria-describedby', hint.id)

    const error = note('', 'danger')
    error.hidden = true
    error.setAttribute('aria-live', 'polite')

    // A concise sentence for screen readers; the visible tables stay silent so a
    // keystroke is not announced twice.
    const status = el('p', { class: 'ts-cidr-sr', role: 'status', 'aria-live': 'polite' })

    const summary = outputBlock('', { label: 'Network block', copy: () => last?.cidr ?? '' })
    const statRow = statStrip()
    const breakdown = kvList()
    const detail = kvList()

    const presetRow = el('div', { class: 'ts-k-chips' })
    const clear = button('Clear', { icon: 'eraser', variant: 'ghost', onClick: () => clearAll() })

    let last: SubnetInfo | null = null

    function renderPresets(version: 4 | 6) {
      const prefixes = version === 4 ? PREFIXES_V4 : PREFIXES_V6
      presetRow.replaceChildren(
        chips(
          prefixes.map((prefix) => ({
            label: `/${prefix}`,
            title: `Use a /${prefix} prefix`,
            onClick: () => {
              const address = input.value.split('/')[0].trim() || SAMPLE
              input.value = `${address}/${prefix}`
              run()
            },
          })),
        ),
      )
    }

    function clearAll() {
      input.value = ''
      run()
      input.focus()
    }

    function blank() {
      last = null
      summary.setValue('—')
      summary.setLabel('Network block')
      summary.setMeta('')
      statRow.replaceChildren()
      detail.replaceChildren()
      clear.disabled = true
    }

    function run() {
      const raw = input.value.trim()
      if (!raw) {
        error.hidden = true
        status.textContent = ''
        blank()
        breakdown.replaceChildren(note('Enter a block, like 192.168.1.10/24, to see its network, host range and netmask.'))
        renderPresets(4)
        return
      }
      try {
        const info = computeSubnet(raw)
        error.hidden = true
        last = info
        clear.disabled = false
        renderPresets(info.version)

        summary.setValue(info.cidr)
        summary.setMeta(`IPv${info.version}`)

        statRow.replaceChildren(
          stat({ label: 'Addresses', value: groupBigInt(info.hostCount) }),
          stat({ label: 'Usable', value: groupBigInt(info.usableCount) }),
          stat({ label: 'Host bits', value: String(info.hostBits) }),
        )

        breakdown.replaceChildren(
          copyRow('Network', info.network),
          copyRow('Broadcast', info.version === 4 ? info.broadcast : 'None on IPv6'),
          copyRow('First host', info.first),
          copyRow('Last host', info.last),
          copyRow('Netmask', info.netmask),
          copyRow('Wildcard', info.wildcard),
        )

        detail.replaceChildren(
          copyRow('Entered address', info.address),
          copyRow('Role', info.role, { copy: false }),
          copyRow('Scope', info.scopeLabel, { copy: false }),
          copyRow('Class', info.addressClass, { copy: false }),
          copyRow('Addresses', groupBigInt(info.hostCount)),
          copyRow('Usable', groupBigInt(info.usableCount)),
          copyRow('Reverse DNS', info.reverseZone),
        )

        status.textContent =
          `Network ${info.network}, prefix /${info.prefix}. ` +
          `${groupBigInt(info.usableCount)} usable address${info.usableCount === '1' ? '' : 'es'}, ` +
          `${approximateCount(BigInt(info.hostCount))} total.`
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : 'Could not parse this block.'
        error.hidden = false
        status.textContent = ''
        blank()
        breakdown.replaceChildren(note('Fix the block above to see its host range.'))
      }
    }

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Block', icon: 'globe' },
          field(input, { label: 'CIDR block or address', forId: input.id }),
          hint,
          presetRow,
          el('div', { class: 'ts-k-actions' }, clear),
          error,
          status,
        ),
        split(
          panel({ title: 'Summary', icon: 'layers', fill: true }, summary, statRow),
          panel({ title: 'Host range', icon: 'sliders', fill: true }, breakdown),
        ),
        panel({ title: 'Address', icon: 'info' }, detail),
      ),
    )

    run()
  },
}

export default tool

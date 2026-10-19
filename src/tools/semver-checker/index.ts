import {
  actions,
  badge,
  button,
  chips,
  copyRow,
  field,
  grid,
  kvList,
  note,
  panel,
  stat,
  stats,
  textField,
  toolLayout,
} from '../../core/components'
import { el } from '../../core/dom'
import type { Tool } from '../../core/types'
import {
  bounds,
  changeKind,
  compare,
  describeParts,
  describeRange,
  isStable,
  nextVersions,
  parse,
  rangeAlternatives,
  satisfies,
  SemverError,
} from './semver'

const EXAMPLES: { label: string; a: string; b: string; range: string }[] = [
  { label: 'npm caret', a: '1.2.3', b: '1.5.0', range: '^1.2.0' },
  { label: 'prerelease', a: '2.0.0-beta.1', b: '2.0.0', range: '>=1.0.0 <2.0.0' },
  { label: 'zero major', a: '0.2.5', b: '0.3.0', range: '^0.2.3' },
  { label: 'wildcard', a: '1.9.4', b: '2.0.0', range: '1.x' },
]

const tool: Tool = {
  slug: 'semver-checker',
  name: 'Semver Checker',
  description: 'Compare versions, test ranges and see the next major, minor and patch bumps.',
  category: 'Code',
  keywords: ['semver', 'semantic', 'version', 'range', 'caret', 'tilde', 'compare', 'npm'],
  render(root) {
    const versionA = textField({ value: '1.2.3', mono: true, onInput: () => run() })
    const versionB = textField({ value: '1.5.0', mono: true, onInput: () => run() })
    const rangeInput = textField({ value: '^1.2.0', mono: true, onInput: () => run() })
    for (const [node, id] of [
      [versionA, 'ts-semver-a'],
      [versionB, 'ts-semver-b'],
      [rangeInput, 'ts-semver-range'],
    ] as const) {
      node.id = id
      node.setAttribute('autocomplete', 'off')
      node.setAttribute('spellcheck', 'false')
      node.setAttribute('autocapitalize', 'off')
      node.setAttribute('inputmode', 'text')
    }
    rangeInput.setAttribute('aria-describedby', 'ts-semver-range-hint')

    const error = note('', 'danger')
    error.hidden = true
    // Announced when it appears, without pulling focus out of the field.
    error.setAttribute('aria-live', 'polite')

    // The visible verdict chips are decorative; this one sentence is what a
    // screen reader hears, so a keystroke is not announced five times over.
    const status = el('p', { class: 'ts-semver-sr', role: 'status', 'aria-live': 'polite' })

    const verdict = el('div', { class: 'ts-k-chips' })
    const rangeWords = el('p', { class: 'ts-k-hint' })
    const boundsRows = kvList()
    const detailRows = kvList()
    const bumpRows = kvList()
    const partsRow = stats()

    const clear = button('Clear', {
      icon: 'eraser',
      variant: 'ghost',
      onClick: () => {
        versionA.value = ''
        versionB.value = ''
        rangeInput.value = ''
        run()
        versionA.focus()
      },
    })

    function clearOutputs() {
      verdict.replaceChildren()
      rangeWords.textContent = ''
      boundsRows.replaceChildren()
      detailRows.replaceChildren()
      bumpRows.replaceChildren()
      partsRow.replaceChildren()
    }

    function run() {
      const aText = versionA.value.trim()
      const bText = versionB.value.trim()
      const rangeText = rangeInput.value.trim()
      clearOutputs()

      if (!aText && !bText && !rangeText) {
        error.hidden = true
        status.textContent = ''
        verdict.replaceChildren(badge('Enter a version to begin', 'neutral'))
        rangeWords.textContent =
          'Versions look like 1.2.3 or 1.0.0-beta.1. Ranges look like ^1.2.0, ~1.2.3, 1.x or >=1.0.0 <2.0.0.'
        return
      }

      // Version A is the subject of every other panel, so its absence is worth
      // naming rather than failing on an empty parse.
      if (!aText) {
        error.textContent = 'Enter Version A — the version the other fields are checked against.'
        error.hidden = false
        status.textContent = 'Enter a version in the Version A field.'
        verdict.replaceChildren(badge('Version A needed', 'neutral'))
        rangeWords.textContent =
          'Versions look like 1.2.3 or 1.0.0-beta.1. Ranges look like ^1.2.0, ~1.2.3, 1.x or >=1.0.0 <2.0.0.'
        return
      }

      let a
      let b
      try {
        a = parse(aText)
        b = bText ? parse(bText) : null
      } catch (err) {
        error.textContent = err instanceof SemverError ? err.message : 'Enter versions like 1.2.3.'
        error.hidden = false
        status.textContent = 'Could not read those versions.'
        return
      }
      error.hidden = true

      partsRow.replaceChildren(...describeParts(a).map((part) => stat({ label: part.label, value: part.value })))
      bumpRows.replaceChildren(...nextVersions(a).map((bump) => copyRow(`${bump.label} (${bump.hint})`, bump.version)))

      let matches = false
      let rangeFailed = false
      if (b) {
        const diff = compare(a, b)
        const relation = diff === 0 ? 'equal to' : diff < 0 ? 'older than' : 'newer than'
        const kind = changeKind(a, b)
        verdict.replaceChildren(
          badge(`${aText} ${relation} ${bText}`),
          badge(isStable(a) ? 'stable' : 'prerelease', isStable(a) ? 'ok' : 'warn'),
          badge(kind.label, kind.tone),
        )
        detailRows.replaceChildren(
          copyRow('Major difference', String(b.major - a.major), { copy: false }),
          copyRow('Minor difference', String(b.minor - a.minor), { copy: false }),
          copyRow('Patch difference', String(b.patch - a.patch), { copy: false }),
        )
      } else {
        verdict.replaceChildren(badge(isStable(a) ? 'stable' : 'prerelease', isStable(a) ? 'ok' : 'warn'))
      }

      if (rangeText) {
        try {
          matches = satisfies(aText, rangeText)
          rangeWords.textContent = describeRange(rangeText)
          const alternatives = rangeAlternatives(rangeText)
          const rows: HTMLElement[] = []
          if (alternatives.length > 1) {
            for (const alternative of alternatives) {
              rows.push(copyRow(alternative, satisfies(aText, alternative) ? 'matches' : 'does not match', { copy: false }))
            }
          } else {
            const group = bounds(rangeText)
            if (group.any) {
              rows.push(copyRow('Bounds', 'any version', { copy: false }))
            } else {
              if (group.min) rows.push(copyRow('Lowest accepted', group.min))
              if (group.max) rows.push(copyRow(group.maxStrict ? 'Below' : 'Highest accepted', group.max, { copy: false }))
            }
            rows.push(copyRow('This version', matches ? 'inside the range' : 'outside the range', { copy: false }))
          }
          boundsRows.replaceChildren(...rows)
          verdict.append(badge(matches ? 'satisfies range' : 'outside range', matches ? 'ok' : 'danger'))
        } catch (err) {
          rangeFailed = true
          rangeWords.textContent = err instanceof SemverError ? err.message : 'That range could not be read.'
          verdict.append(badge('range not understood', 'danger'))
        }
      } else {
        rangeWords.textContent = 'Add a range to test it, for example ^1.2.0 or >=1.0.0 <2.0.0.'
      }

      // One concise sentence for the whole outcome.
      const bits: string[] = []
      if (b) {
        const diff = compare(a, b)
        bits.push(diff === 0 ? `${aText} equals ${bText}` : `${aText} is ${diff < 0 ? 'older' : 'newer'} than ${bText}`)
        bits.push(changeKind(a, b).label)
      } else {
        bits.push(isStable(a) ? `${aText} is a stable release` : `${aText} is a prerelease`)
      }
      if (rangeText) {
        if (rangeFailed) {
          bits.push(rangeText.length <= 40 ? `the range ${rangeText} could not be read` : 'the range could not be read')
        } else bits.push(matches ? `it satisfies ${rangeText}` : `it does not satisfy ${rangeText}`)
      }
      status.textContent = `${bits.join('; ')}.`
    }

    const exampleRow = chips(
      EXAMPLES.map((example) => ({
        label: example.label,
        title: `${example.a} / ${example.b} / ${example.range}`,
        onClick: () => {
          versionA.value = example.a
          versionB.value = example.b
          rangeInput.value = example.range
          run()
        },
      })),
    )

    root.append(
      toolLayout(
        { wide: true },
        panel(
          { title: 'Versions', icon: 'hash' },
          actions(
            field(versionA, { label: 'Version A', forId: versionA.id, grow: true }),
            field(versionB, { label: 'Version B', forId: versionB.id, grow: true }),
            field(rangeInput, { label: 'Range to test', forId: rangeInput.id, grow: true }),
          ),
          el(
            'p',
            { class: 'ts-k-hint', id: 'ts-semver-range-hint' },
            'Supports exact versions, comparators, ^, ~, x/* wildcards, hyphen ranges and || unions.',
          ),
          exampleRow,
          actions(clear),
          error,
        ),
        panel({ title: 'Verdict', icon: 'check' }, verdict, rangeWords),
        grid(
          320,
          panel({ title: 'Version A parts', icon: 'layers' }, partsRow),
          panel({ title: 'Against version B', icon: 'swap' }, detailRows),
        ),
        grid(
          320,
          panel({ title: 'Range limits', icon: 'ruler' }, boundsRows),
          panel({ title: 'Next versions from A', icon: 'arrowUp' }, bumpRows),
        ),
        status,
      ),
    )

    run()
  },
}

export default tool

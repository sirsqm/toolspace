/**
 * Cubic Bézier easing.
 *
 * A CSS timing function is a cubic Bézier with its end points pinned at (0,0)
 * and (1,1); only the two control points vary. Evaluating it means solving for
 * the curve parameter that produces a given x, which is done with a few
 * Newton steps and a bisection fallback when the derivative is too flat.
 * The x coordinates are limited to 0-1 as CSS requires, so the curve is always
 * a function of progress; the y coordinates are free, which allows overshoot.
 *
 * The same module owns the geometry the preview needs — the drawing window,
 * the pointer-to-curve mapping and the "when does it get there" inverse — so
 * that everything the tool shows can be checked without a browser.
 */

export class BezierError extends Error {}

export interface Bezier {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const PRESETS: Record<string, Bezier> = {
  linear: { x1: 0, y1: 0, x2: 1, y2: 1 },
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  'material standard': { x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
  'material decelerate': { x1: 0, y1: 0, x2: 0.2, y2: 1 },
  'material accelerate': { x1: 0.4, y1: 0, x2: 1, y2: 1 },
  'material sharp': { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
  'back out (overshoot)': { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
  'back in (anticipate)': { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 },
  'snap (very fast out)': { x1: 0.1, y1: 0.9, x2: 0.2, y2: 1 },
}

export function presetNames(): string[] {
  return Object.keys(PRESETS)
}

/**
 * How far outside 0-1 a y control point may sit before the tool refuses it.
 * CSS itself allows any number, but past this the curve is a vertical line on
 * screen and every readout is meaningless, so it is an input error rather than
 * a silently clamped value.
 */
export const Y_LIMIT = 100

function number(value: string, label: string): number {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed)) {
    throw new BezierError(`${label} is not a number — use a decimal such as 0.42`)
  }
  return parsed
}

/**
 * Parse `cubic-bezier(a, b, c, d)`, a bare list of four numbers, or a preset
 * name. Messages name the offending value so the fix is obvious.
 */
export function parseBezier(input: string): Bezier {
  const text = input.trim().replace(/[;\s]+$/, '')
  if (!text) {
    throw new BezierError('Enter a cubic-bezier value, a preset name such as ease-in-out, or four numbers')
  }

  const preset = PRESETS[text.toLowerCase()]
  if (preset) return { ...preset }

  if (/^steps?\s*\(/i.test(text)) {
    throw new BezierError('steps() is a step timing function, not a cubic Bézier — enter four numbers instead')
  }
  if (/^linear\s*\(/i.test(text)) {
    throw new BezierError('linear() lists stops rather than control points — use four numbers instead')
  }

  const match = /^cubic-bezier\s*\(([\s\S]*)\)$/i.exec(text)
  if (!match && /^cubic-bezier/i.test(text)) {
    throw new BezierError('Write it as cubic-bezier(0.42, 0, 0.58, 1)')
  }

  const parts = (match ? match[1] : text).split(/[\s,]+/).filter(Boolean)
  if (parts.length !== 4) {
    throw new BezierError(
      `A cubic-bezier needs exactly four numbers; ${parts.length === 0 ? 'none were given' : `you gave ${parts.length}`}`,
    )
  }

  const [x1, y1, x2, y2] = [
    number(parts[0], 'x1'),
    number(parts[1], 'y1'),
    number(parts[2], 'x2'),
    number(parts[3], 'y2'),
  ]

  for (const [value, label] of [
    [x1, 'x1'],
    [x2, 'x2'],
  ] as const) {
    if (value < 0 || value > 1) throw new BezierError(`${label} must be between 0 and 1`)
  }
  for (const [value, label] of [
    [y1, 'y1'],
    [y2, 'y2'],
  ] as const) {
    if (Math.abs(value) > Y_LIMIT) {
      throw new BezierError(`${label} of ${value} is beyond ±${Y_LIMIT} — that is not a usable curve`)
    }
  }
  return { x1, y1, x2, y2 }
}

/** The four coefficients for one axis of the curve. */
function coefficients(p1: number, p2: number): [number, number, number] {
  const c = 3 * p1
  const b = 3 * (p2 - p1) - c
  const a = 1 - c - b
  return [a, b, c]
}

function sample(coefficients: [number, number, number], t: number): number {
  const [a, b, c] = coefficients
  return ((a * t + b) * t + c) * t
}

function slope(coefficients: [number, number, number], t: number): number {
  const [a, b, c] = coefficients
  return (3 * a * t + 2 * b) * t + c
}

/** Solve for t where x(t) equals the target, then return y(t). */
function solveX(ax: [number, number, number], x: number): number {
  let t = x
  for (let i = 0; i < 8; i++) {
    const error = sample(ax, t) - x
    if (Math.abs(error) < 1e-7) return t
    const derivative = slope(ax, t)
    if (Math.abs(derivative) < 1e-6) break
    t -= error / derivative
  }

  let low = 0
  let high = 1
  t = x
  for (let i = 0; i < 40; i++) {
    const value = sample(ax, t)
    if (Math.abs(value - x) < 1e-7) return t
    if (value > x) high = t
    else low = t
    t = (low + high) / 2
  }
  return t
}

/** Build an easing function y(x) for the given control points. */
export function createEasing(bezier: Bezier): (x: number) => number {
  const ax = coefficients(bezier.x1, bezier.x2)
  const ay = coefficients(bezier.y1, bezier.y2)
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    return sample(ay, solveX(ax, x))
  }
}

/** Evaluate the curve directly at a progress value. */
export function evaluate(bezier: Bezier, x: number): number {
  return createEasing(bezier)(x)
}

/** Points along the curve for drawing a preview. */
export function sampleCurve(bezier: Bezier, steps = 100): { x: number; y: number }[] {
  if (!Number.isInteger(steps) || steps < 2) throw new BezierError('Steps must be an integer of 2 or more')
  const easing = createEasing(bezier)
  return Array.from({ length: steps + 1 }, (_, index) => {
    const x = index / steps
    return { x, y: easing(x) }
  })
}

/**
 * The first progress value at which the curve reaches `value`, or null when it
 * never does. This is the inverse of the easing — "how far through the
 * duration does the element get half way?" — and it is what makes a duration
 * readout meaningful. A non-monotonic curve reports its first crossing.
 */
export function solveY(bezier: Bezier, value: number, steps = 200): number | null {
  if (!Number.isFinite(value)) throw new BezierError('The target value must be a number')
  if (!Number.isInteger(steps) || steps < 2) throw new BezierError('Steps must be an integer of 2 or more')
  const easing = createEasing(bezier)
  if (value <= 0) return 0
  if (easing(0) >= value) return 0

  let previousX = 0
  for (let i = 1; i <= steps; i++) {
    const x = i / steps
    if (easing(x) >= value) {
      let low = previousX
      let high = x
      for (let j = 0; j < 40; j++) {
        const mid = (low + high) / 2
        if (easing(mid) >= value) high = mid
        else low = mid
      }
      return (low + high) / 2
    }
    previousX = x
  }
  return null
}

function trim(value: number): string {
  return String(Number(value.toFixed(4)))
}

/** CSS text for the curve. */
export function toCss(bezier: Bezier): string {
  if (bezier.x1 === 0 && bezier.y1 === 0 && bezier.x2 === 1 && bezier.y2 === 1) return 'linear'
  return `cubic-bezier(${trim(bezier.x1)}, ${trim(bezier.y1)}, ${trim(bezier.x2)}, ${trim(bezier.y2)})`
}

export interface TransitionOptions {
  property?: string
  /** A preset name to print instead of the numbers, when the curve matches one. */
  name?: string
}

/**
 * The declaration a user actually pastes, using the duration from the form —
 * a bare `cubic-bezier(...)` rarely ends up in a stylesheet on its own. A
 * curve that matches a preset is written with that name, which is what a
 * stylesheet author would have typed by hand.
 */
export function toTransitionCss(bezier: Bezier, durationMs: number, options: TransitionOptions = {}): string {
  const ms = Number.isFinite(durationMs) ? Math.round(Math.max(0, durationMs)) : 0
  const timing = options.name ?? toCss(bezier)
  return `transition: ${options.property ?? 'transform'} ${ms}ms ${timing};`
}

export interface BezierSummary {
  progress: { at: number; value: number }[]
  /** True when the drawn curve itself leaves 0-1, not just a control point. */
  overshoot: boolean
  /** How far past the range it goes, as a positive number (0 when it does not). */
  overshootAmount: number
  min: number
  max: number
  /** True when progress ever moves backwards, which CSS forbids in practice. */
  nonMonotonic: boolean
  fastestAt: number
  /** The largest step-to-step change, as a multiple of the average speed. */
  peakSpeed: number
  /** Progress at which the curve first covers half the distance, or null. */
  halfwayAt: number | null
}

/** A quick read of the curve's shape, from one shared sample pass. */
export function summarise(bezier: Bezier, steps = 200): BezierSummary {
  if (!Number.isInteger(steps) || steps < 2) throw new BezierError('Steps must be an integer of 2 or more')
  const easing = createEasing(bezier)

  const values: number[] = [0]
  for (let i = 1; i <= steps; i++) values.push(easing(i / steps))

  let min = 0
  let max = 0
  let fastestAt = 0
  let peakSpeed = 0
  let nonMonotonic = false
  for (let i = 1; i <= steps; i++) {
    const value = values[i]
    if (value < min) min = value
    if (value > max) max = value
    const speed = (value - values[i - 1]) * steps
    if (speed > peakSpeed) {
      peakSpeed = speed
      fastestAt = i / steps
    }
    if (value < values[i - 1] - 1e-9) nonMonotonic = true
  }

  const overshootAmount = Math.max(0, max - 1, -min)

  return {
    progress: [0.25, 0.5, 0.75].map((at) => ({ at, value: easing(at) })),
    overshoot: overshootAmount > 1e-6,
    overshootAmount,
    min,
    max,
    nonMonotonic,
    fastestAt,
    peakSpeed,
    halfwayAt: solveY(bezier, 0.5, steps),
  }
}

/** The y window the preview draws in; a larger control point is pinned to it. */
export const DISPLAY_MIN_Y = -1
export const DISPLAY_MAX_Y = 2

export interface ViewBox {
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * A viewBox, in drawing units (y grows downward, so curve y is negated), that
 * always contains the whole curve plus its control points, with a little air.
 * The y window is capped so an extreme control point cannot squash the preview
 * into a sliver; the drawn geometry is clamped to the same window.
 */
export function viewBoxFor(bezier: Bezier, padding = 0.06): ViewBox {
  const ys = [0, 1, bezier.y1, bezier.y2]
  for (const point of sampleCurve(bezier, 120)) ys.push(point.y)
  const min = Math.max(Math.min(...ys), DISPLAY_MIN_Y)
  const max = Math.min(Math.max(...ys), DISPLAY_MAX_Y)
  return {
    minX: -padding,
    // The top edge is the highest curve y, negated.
    minY: -(max + padding),
    width: 1 + 2 * padding,
    height: max - min + 2 * padding,
  }
}

export function viewBoxString(box: ViewBox): string {
  const round = (value: number) => Number(value.toFixed(4))
  return `${round(box.minX)} ${round(box.minY)} ${round(box.width)} ${round(box.height)}`
}

/** Clamp a curve's control points into the drawing window, so nothing is off-screen. */
export function clampToView(bezier: Bezier, box: ViewBox): Bezier {
  const top = -box.minY
  const bottom = -(box.minY + box.height)
  const clamp = (value: number) => Math.min(top, Math.max(bottom, value))
  return { x1: bezier.x1, y1: clamp(bezier.y1), x2: bezier.x2, y2: clamp(bezier.y2) }
}

export interface Rect {
  width: number
  height: number
}

/**
 * Map a pointer position inside the SVG's client box onto curve coordinates.
 * `preserveAspectRatio="xMidYMid meet"` letterboxes the drawing, so the scale
 * is the smaller of the two axes and the drawing is centred — a plain
 * divide-by-width drifts as soon as the box is not the viewBox's shape.
 */
export function pointToCurve(box: ViewBox, rect: Rect, clientX: number, clientY: number): { x: number; y: number } {
  const scale = Math.min(rect.width / box.width, rect.height / box.height) || 1
  const offsetX = (rect.width - box.width * scale) / 2
  const offsetY = (rect.height - box.height * scale) / 2
  return {
    x: box.minX + (clientX - offsetX) / scale,
    y: -(box.minY + (clientY - offsetY) / scale),
  }
}

export interface Rail {
  min: number
  max: number
}

/**
 * The value range the moving-dot preview runs along. It always covers 0-1 so
 * the start and end of the animation are on the rail, and it widens to take in
 * any overshoot — otherwise the dot would leave the track and be clipped, and
 * the one thing an overshoot curve is for would be invisible.
 */
export function railFor(summary: { min: number; max: number }): Rail {
  const min = Math.min(0, summary.min)
  const max = Math.max(1, summary.max)
  return { min, max: max > min ? max : min + 1 }
}

/** Where a value sits along the rail, as a 0-1 fraction. */
export function railPosition(value: number, rail: Rail): number {
  const span = rail.max - rail.min
  if (!(span > 0)) return 0
  return Math.min(1, Math.max(0, (value - rail.min) / span))
}

/** Milliseconds into the duration at which the curve first covers `value`. */
export function timeToReach(bezier: Bezier, value: number, durationMs: number): number | null {
  const at = solveY(bezier, value)
  if (at == null) return null
  return at * Math.max(0, durationMs)
}

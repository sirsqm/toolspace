import { describe, expect, it } from 'vitest'
import {
  BezierError,
  clampToView,
  createEasing,
  evaluate,
  parseBezier,
  pointToCurve,
  PRESETS,
  presetNames,
  railFor,
  railPosition,
  sampleCurve,
  solveY,
  summarise,
  timeToReach,
  toCss,
  toTransitionCss,
  viewBoxFor,
  viewBoxString,
  Y_LIMIT,
} from './bezier'

describe('parseBezier', () => {
  it('reads the CSS function form', () => {
    expect(parseBezier('cubic-bezier(0.42, 0, 0.58, 1)')).toEqual({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 })
  })

  it('tolerates whitespace, casing and a trailing semicolon', () => {
    expect(parseBezier('  CUBIC-BEZIER ( 0.42 ,0, 0.58 , 1 ) ; ')).toEqual({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 })
  })

  it('reads a bare list of numbers', () => {
    expect(parseBezier('0 0 1 1')).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 })
  })

  it('reads negative and exponent forms', () => {
    expect(parseBezier('0.36, 0, 0.66, -0.56')).toEqual({ x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 })
    expect(parseBezier('0.42 0 0.58 1e0')).toEqual({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 })
  })

  it('resolves preset names case-insensitively', () => {
    expect(parseBezier('ease-in-out')).toEqual(PRESETS['ease-in-out'])
    expect(parseBezier('EASE')).toEqual(PRESETS.ease)
    expect(parseBezier('  Linear ')).toEqual(PRESETS.linear)
  })

  it('returns a copy of a preset, not the shared object', () => {
    const parsed = parseBezier('ease')
    parsed.y1 = 99
    expect(PRESETS.ease.y1).toBe(0.1)
  })

  it('rejects the wrong number of values and says how many it saw', () => {
    expect(() => parseBezier('cubic-bezier(0, 0, 1)')).toThrow(/you gave 3/)
    expect(() => parseBezier('0 0 1 1 1')).toThrow(/you gave 5/)
    expect(() => parseBezier('')).toThrow(/four numbers/)
    expect(() => parseBezier('   ')).toThrow(BezierError)
  })

  it('rejects x outside 0-1 but allows overshooting y', () => {
    expect(() => parseBezier('cubic-bezier(1.5, 0, 0.5, 1)')).toThrow(/x1 must be between 0 and 1/)
    expect(() => parseBezier('cubic-bezier(0, 0, -0.1, 1)')).toThrow(/x2 must be between 0 and 1/)
    expect(parseBezier('cubic-bezier(0.34, 1.56, 0.64, 1)').y1).toBe(1.56)
    expect(parseBezier('cubic-bezier(0.36, 0, 0.66, -0.56)').y2).toBe(-0.56)
  })

  it('allows the extreme but legal x values', () => {
    expect(parseBezier('cubic-bezier(0, 0, 1, 1)').x2).toBe(1)
    expect(parseBezier('cubic-bezier(1, 0, 0, 1)').x1).toBe(1)
  })

  it('refuses a y that is not a usable curve', () => {
    expect(() => parseBezier(`cubic-bezier(0.2, 0, 0.4, ${Y_LIMIT + 1})`)).toThrow(/beyond ±100/)
    expect(parseBezier(`cubic-bezier(0.2, 0, 0.4, ${Y_LIMIT})`).y2).toBe(Y_LIMIT)
  })

  it('names the value that is not a number', () => {
    expect(() => parseBezier('0.2, nope, 0.4, 1')).toThrow(/y1 is not a number/)
    expect(() => parseBezier('0.2, 0, 0.4, ')).toThrow(/you gave 3/)
    expect(() => parseBezier('NaN 0 1 1')).toThrow(/x1 is not a number/)
    expect(() => parseBezier('Infinity 0 1 1')).toThrow(/x1 is not a number/)
  })

  it('explains the timing functions it cannot represent', () => {
    expect(() => parseBezier('steps(4, end)')).toThrow(/step timing function/)
    expect(() => parseBezier('linear(0, 0.5 50%, 1)')).toThrow(/lists stops/)
    expect(() => parseBezier('cubic-bezier 0.2 0 0.4 1')).toThrow(/Write it as cubic-bezier/)
    expect(() => parseBezier('cubic-bezier(0.2, 0, 0.4, 1')).toThrow(/Write it as cubic-bezier/)
  })
})

describe('evaluate', () => {
  it('is pinned at both ends', () => {
    for (const bezier of Object.values(PRESETS)) {
      expect(evaluate(bezier, 0)).toBe(0)
      expect(evaluate(bezier, 1)).toBe(1)
    }
  })

  it('is the identity for linear', () => {
    const easing = createEasing(PRESETS.linear)
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(easing(x)).toBeCloseTo(x, 5)
  })

  it('starts slowly for ease-in', () => {
    expect(evaluate(PRESETS['ease-in'], 0.25)).toBeLessThan(0.25)
  })

  it('starts quickly for ease-out', () => {
    expect(evaluate(PRESETS['ease-out'], 0.25)).toBeGreaterThan(0.25)
  })

  it('is symmetric for ease-in-out', () => {
    const easing = createEasing(PRESETS['ease-in-out'])
    expect(easing(0.5)).toBeCloseTo(0.5, 3)
    expect(easing(0.25) + easing(0.75)).toBeCloseTo(1, 3)
  })

  it('overshoots for a back-out curve', () => {
    expect(evaluate(PRESETS['back out (overshoot)'], 0.7)).toBeGreaterThan(1)
  })

  it('anticipates for a back-in curve', () => {
    expect(evaluate(PRESETS['back in (anticipate)'], 0.2)).toBeLessThan(0)
  })

  it('clamps outside the range', () => {
    const easing = createEasing(PRESETS.ease)
    expect(easing(-1)).toBe(0)
    expect(easing(2)).toBe(1)
  })

  it('survives a degenerate flat-x curve where the derivative vanishes', () => {
    // x1 = x2 = 0 makes x(t) = t³, so Newton stalls at t = 0 and the bisection
    // fallback has to carry the solve. This is the path that used to hang.
    const easing = createEasing({ x1: 0, y1: 0, x2: 0, y2: 1 })
    expect(easing(0.5)).toBeGreaterThan(0.8)
    expect(easing(0.125)).toBeCloseTo(0.5, 3)
  })

  it('handles x1 = x2 = 1', () => {
    const easing = createEasing({ x1: 1, y1: 0, x2: 1, y2: 1 })
    expect(easing(0.875)).toBeCloseTo(0.5, 3)
  })

  it('stays finite for extreme y control points', () => {
    for (const y of [-100, -3, 4, 100]) {
      const value = evaluate({ x1: 0.25, y1: y, x2: 0.75, y2: y }, 0.5)
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('sampleCurve', () => {
  it('returns the requested number of points plus the end', () => {
    const points = sampleCurve(PRESETS.ease, 10)
    expect(points).toHaveLength(11)
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[10].x).toBe(1)
  })

  it('increases in x', () => {
    const points = sampleCurve(PRESETS['ease-in-out'], 20)
    for (let i = 1; i < points.length; i++) expect(points[i].x).toBeGreaterThan(points[i - 1].x)
  })

  it('rejects a silly step count', () => {
    expect(() => sampleCurve(PRESETS.ease, 1)).toThrow(BezierError)
    expect(() => sampleCurve(PRESETS.ease, 2.5)).toThrow(BezierError)
    expect(() => sampleCurve(PRESETS.ease, 0)).toThrow(BezierError)
  })

  it('allows the minimum of two steps', () => {
    expect(sampleCurve(PRESETS.ease, 2)).toHaveLength(3)
  })
})

describe('solveY', () => {
  it('inverts the easing at the halfway mark', () => {
    const at = solveY(PRESETS['ease-in'], 0.5)
    expect(at).not.toBeNull()
    expect(evaluate(PRESETS['ease-in'], at!)).toBeCloseTo(0.5, 4)
    expect(at!).toBeGreaterThan(0.5)
  })

  it('is exact at the ends', () => {
    expect(solveY(PRESETS.ease, 0)).toBe(0)
    expect(solveY(PRESETS.ease, 1)).toBeCloseTo(1, 4)
    expect(solveY(PRESETS.ease, -1)).toBe(0)
  })

  it('returns null when the curve never gets there', () => {
    // The curve is pinned at (1,1), so any value at or below 1 is reached;
    // a target above the curve's own peak is the genuinely unreachable case.
    expect(solveY({ x1: 0.2, y1: 0, x2: 0.4, y2: 0.4 }, 1.2)).toBeNull()
    expect(solveY(PRESETS['back out (overshoot)'], 1.5)).toBeNull()
  })

  it('reports the first crossing for an overshooting curve', () => {
    const at = solveY(PRESETS['back out (overshoot)'], 1)
    expect(at).not.toBeNull()
    expect(at!).toBeLessThan(1)
    expect(at!).toBeGreaterThan(0)
  })

  it('rejects nonsense arguments', () => {
    expect(() => solveY(PRESETS.ease, Number.NaN)).toThrow(BezierError)
    expect(() => solveY(PRESETS.ease, 0.5, 1)).toThrow(BezierError)
  })
})

describe('toCss', () => {
  it('names the linear curve', () => {
    expect(toCss(PRESETS.linear)).toBe('linear')
  })

  it('writes the cubic-bezier function', () => {
    expect(toCss({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 })).toBe('cubic-bezier(0.42, 0, 0.58, 1)')
  })

  it('trims trailing zeros without losing precision', () => {
    expect(toCss({ x1: 0.123456, y1: -0.5, x2: 0.99999, y2: 1 })).toBe('cubic-bezier(0.1235, -0.5, 1, 1)')
  })

  it('round-trips through the parser', () => {
    for (const bezier of Object.values(PRESETS)) {
      if (toCss(bezier) === 'linear') continue
      expect(parseBezier(toCss(bezier))).toEqual(bezier)
    }
  })
})

describe('toTransitionCss', () => {
  it('writes a full declaration with the duration', () => {
    expect(toTransitionCss(PRESETS.ease, 900)).toBe('transition: transform 900ms cubic-bezier(0.25, 0.1, 0.25, 1);')
  })

  it('prefers a preset name when the curve matches one', () => {
    expect(toTransitionCss(PRESETS.ease, 900, { name: 'ease' })).toBe('transition: transform 900ms ease;')
  })

  it('takes a property name and rounds the duration', () => {
    expect(toTransitionCss({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }, 299.6, { property: 'opacity' })).toBe(
      'transition: opacity 300ms cubic-bezier(0.42, 0, 0.58, 1);',
    )
  })

  it('never emits a negative or non-finite duration', () => {
    expect(toTransitionCss(PRESETS.ease, -50)).toBe('transition: transform 0ms cubic-bezier(0.25, 0.1, 0.25, 1);')
    expect(toTransitionCss(PRESETS.ease, Number.NaN)).toBe(
      'transition: transform 0ms cubic-bezier(0.25, 0.1, 0.25, 1);',
    )
  })
})

describe('summarise', () => {
  it('reports progress at the quarters', () => {
    const result = summarise(PRESETS.linear)
    const values = result.progress.map((point) => point.value)
    expect(values).toHaveLength(3)
    for (const [index, expected] of [0.25, 0.5, 0.75].entries()) expect(values[index]).toBeCloseTo(expected, 6)
  })

  it('flags overshoot and reports how far past it goes', () => {
    const back = summarise(PRESETS['back out (overshoot)'])
    expect(back.overshoot).toBe(true)
    expect(back.overshootAmount).toBeGreaterThan(0.05)
    expect(back.max).toBeCloseTo(1 + back.overshootAmount, 6)
    expect(summarise(PRESETS.ease).overshoot).toBe(false)
    expect(summarise(PRESETS.ease).overshootAmount).toBe(0)
  })

  it('does not call a control point an overshoot when the curve stays in range', () => {
    // y1 > 1 pulls the curve up but never past 1, so there is nothing to warn about.
    const result = summarise({ x1: 0, y1: 1.5, x2: 1, y2: 0.5 })
    expect(result.max).toBeLessThanOrEqual(1)
    expect(result.min).toBeGreaterThanOrEqual(0)
    expect(result.overshoot).toBe(false)
    expect(result.overshootAmount).toBe(0)
  })

  it('reports the anticipation low point as an overshoot', () => {
    const result = summarise(PRESETS['back in (anticipate)'])
    expect(result.min).toBeLessThan(0)
    expect(result.overshoot).toBe(true)
  })

  it('finds where the curve moves fastest', () => {
    expect(summarise(PRESETS['ease-in']).fastestAt).toBeGreaterThan(0.5)
    expect(summarise(PRESETS['ease-out']).fastestAt).toBeLessThan(0.5)
    expect(summarise(PRESETS.linear).peakSpeed).toBeCloseTo(1, 1)
  })

  it('finds where the curve is half way', () => {
    expect(summarise(PRESETS.linear).halfwayAt).toBeCloseTo(0.5, 4)
    expect(summarise(PRESETS['ease-in']).halfwayAt!).toBeGreaterThan(0.5)
    // Every curve is pinned at both ends, so the half-way point always exists.
    for (const bezier of Object.values(PRESETS)) expect(summarise(bezier).halfwayAt).not.toBeNull()
  })

  it('detects a curve that moves backwards', () => {
    expect(summarise(PRESETS['back in (anticipate)']).nonMonotonic).toBe(true)
    expect(summarise(PRESETS['ease-in-out']).nonMonotonic).toBe(false)
  })

  it('rejects a silly step count', () => {
    expect(() => summarise(PRESETS.ease, 1)).toThrow(BezierError)
    expect(() => summarise(PRESETS.ease, 2.5)).toThrow(BezierError)
  })
})

describe('viewBoxFor', () => {
  it('covers the whole curve with padding on every side', () => {
    const box = viewBoxFor(PRESETS['back out (overshoot)'])
    expect(box.minX).toBeLessThan(0)
    expect(box.minX + box.width).toBeGreaterThan(1)
    // y is negated: the top edge sits above the peak, the bottom below 0.
    expect(-box.minY).toBeGreaterThan(1.56)
    // The bottom edge sits just below the curve's start, inside the padding.
    expect(box.minY + box.height).toBeGreaterThan(0)
  })

  it('keeps a plain curve inside a tight window', () => {
    const box = viewBoxFor(PRESETS['ease-in-out'])
    expect(-box.minY).toBeGreaterThanOrEqual(1)
    expect(box.minY + box.height).toBeGreaterThanOrEqual(0)
    expect(box.height).toBeCloseTo(1.12, 6)
  })

  it('caps the window for an extreme control point', () => {
    const box = viewBoxFor({ x1: 0.2, y1: 0, x2: 0.4, y2: Y_LIMIT })
    expect(-box.minY).toBeLessThanOrEqual(2.1)
    expect(box.height).toBeLessThan(4)
  })

  it('serialises to four rounded numbers', () => {
    expect(viewBoxString({ minX: -0.06, minY: -2.06, width: 1.12, height: 3.12 })).toBe('-0.06 -2.06 1.12 3.12')
  })
})

describe('clampToView', () => {
  it('pulls an off-window control point back to the edge', () => {
    const box = viewBoxFor({ x1: 0.2, y1: 0, x2: 0.4, y2: Y_LIMIT })
    const clamped = clampToView({ x1: 0.2, y1: 0, x2: 0.4, y2: Y_LIMIT }, box)
    expect(clamped.y2).toBeLessThanOrEqual(-box.minY)
    expect(clamped.y2).toBeGreaterThan(1)
  })

  it('leaves a normal curve untouched', () => {
    const box = viewBoxFor(PRESETS.ease)
    expect(clampToView(PRESETS.ease, box)).toEqual(PRESETS.ease)
  })
})

describe('pointToCurve', () => {
  const box = viewBoxFor(PRESETS.linear)
  const rect = { width: 200, height: 200 }

  it('maps the corners of a square box onto the viewBox', () => {
    const topLeft = pointToCurve(box, rect, 0, 0)
    expect(topLeft.x).toBeCloseTo(box.minX, 6)
    expect(topLeft.y).toBeCloseTo(-box.minY, 6)
    const bottomRight = pointToCurve(box, rect, 200, 200)
    expect(bottomRight.x).toBeCloseTo(box.minX + box.width, 6)
    expect(bottomRight.y).toBeCloseTo(-(box.minY + box.height), 6)
  })

  it('accounts for letterboxing when the box is wider than the drawing', () => {
    const wide = { width: 400, height: 200 }
    const centre = pointToCurve(box, wide, 200, 100)
    expect(centre.x).toBeCloseTo(box.minX + box.width / 2, 6)
    // The drawing is centred horizontally, so the x of the left edge of the
    // drawing is not the left edge of the element.
    expect(pointToCurve(box, wide, 100, 0).x).toBeCloseTo(box.minX, 6)
  })

  it('does not divide by zero on a zero-sized box', () => {
    const point = pointToCurve(box, { width: 0, height: 0 }, 0, 0)
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
  })
})

describe('railFor / railPosition', () => {
  it('always covers the full 0-1 range', () => {
    expect(railFor({ min: 0, max: 1 })).toEqual({ min: 0, max: 1 })
  })

  it('widens for overshoot so the dot stays on the track', () => {
    const summary = summarise(PRESETS['back out (overshoot)'])
    const rail = railFor(summary)
    expect(rail.max).toBeGreaterThan(1)
    // The end of the animation (value 1) sits short of the track's end, so the
    // overshoot beyond it is visible rather than pinned to the edge.
    expect(railPosition(summary.max, rail)).toBe(1)
    expect(railPosition(1, rail)).toBeLessThan(1)
    expect(railPosition(1, rail)).toBeGreaterThan(0.5)
    expect(railPosition(1.5, rail)).toBe(1)
  })

  it('widens downwards for anticipation', () => {
    const rail = railFor(summarise(PRESETS['back in (anticipate)']))
    expect(rail.min).toBeLessThan(0)
  })

  it('pins the ends of the rail', () => {
    const rail = { min: -0.5, max: 1.5 }
    expect(railPosition(-0.5, rail)).toBe(0)
    expect(railPosition(1.5, rail)).toBe(1)
    expect(railPosition(-9, rail)).toBe(0)
    expect(railPosition(9, rail)).toBe(1)
  })

  it('does not divide by zero on a collapsed rail', () => {
    expect(railPosition(1, { min: 1, max: 1 })).toBe(0)
  })
})

describe('timeToReach', () => {
  it('turns a progress fraction into milliseconds', () => {
    expect(timeToReach(PRESETS.linear, 0.5, 1000)).toBeCloseTo(500, 3)
  })

  it('is later than half the duration for a slow start', () => {
    expect(timeToReach(PRESETS['ease-in'], 0.5, 1000)!).toBeGreaterThan(500)
  })

  it('returns null when the target is never reached', () => {
    expect(timeToReach(PRESETS['back out (overshoot)'], 1.5, 1000)).toBeNull()
  })

  it('treats a negative duration as zero rather than going backwards', () => {
    expect(timeToReach(PRESETS.linear, 0.5, -100)).toBe(0)
  })
})

describe('presets', () => {
  it('lists names that all parse back to themselves', () => {
    for (const name of presetNames()) expect(parseBezier(name)).toEqual(PRESETS[name])
  })

  it('keeps every x inside 0-1', () => {
    for (const bezier of Object.values(PRESETS)) {
      expect(bezier.x1).toBeGreaterThanOrEqual(0)
      expect(bezier.x1).toBeLessThanOrEqual(1)
      expect(bezier.x2).toBeGreaterThanOrEqual(0)
      expect(bezier.x2).toBeLessThanOrEqual(1)
    }
  })

  it('keeps every preset inside the y limit', () => {
    for (const bezier of Object.values(PRESETS)) {
      expect(Math.abs(bezier.y1)).toBeLessThanOrEqual(Y_LIMIT)
      expect(Math.abs(bezier.y2)).toBeLessThanOrEqual(Y_LIMIT)
    }
  })

  it('includes the CSS keywords', () => {
    for (const name of ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']) {
      expect(PRESETS[name]).toBeDefined()
    }
  })
})

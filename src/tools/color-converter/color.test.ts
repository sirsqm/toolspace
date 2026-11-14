import { describe, expect, it } from 'vitest'
import {
  composite,
  contrastRatio,
  contrastVerdict,
  evaluateContrast,
  formatHex,
  formatHsl,
  formatRgb,
  formatRgba,
  hslToRgb,
  parseColor,
  parseColorWithAlpha,
  relativeLuminance,
  rgbToHsl,
  toHex,
  type Rgb,
  type Rgba,
} from './color'

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

describe('parseColor', () => {
  it('parses long hex with and without the hash', () => {
    expect(parseColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseColor('ff8800')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('expands shorthand hex', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('parses rgb() notation', () => {
    expect(parseColor('rgb(255, 136, 0)')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseColor('rgb(255 136 0)')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('rejects nonsense', () => {
    expect(parseColor('not a colour')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor('rgb(300, 0, 0)')).toBeNull()
  })
})

describe('parseColorWithAlpha', () => {
  it('reads alpha out of eight-digit hex', () => {
    expect(parseColorWithAlpha('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 })
    expect(parseColorWithAlpha('#ffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it('reads alpha out of four-digit hex', () => {
    const parsed = parseColorWithAlpha('#0000')!
    expect(parsed.r).toBe(0)
    expect(parsed.a).toBe(0)
  })

  it('parses rgba() with a comma or a slash', () => {
    expect(parseColorWithAlpha('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseColorWithAlpha('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
  })

  it('parses rgb() percentages', () => {
    expect(parseColorWithAlpha('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it('parses hsl() into rgb, with and without alpha', () => {
    expect(parseColorWithAlpha('hsl(0 100% 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColorWithAlpha('hsla(120, 100%, 50%, 0.25)')).toEqual({ r: 0, g: 255, b: 0, a: 0.25 })
  })

  it('rejects out-of-range channels rather than clamping', () => {
    expect(parseColorWithAlpha('rgba(0,0,0,2)')).toBeNull()
    expect(parseColorWithAlpha('rgb(-1 0 0)')).toBeNull()
    expect(parseColorWithAlpha('hsl(0 200% 50%)')).toBeNull()
    expect(parseColorWithAlpha('hsl(0 50% 150%)')).toBeNull()
  })

  it('rejects a wrong argument count', () => {
    expect(parseColorWithAlpha('rgb(1 2)')).toBeNull()
    expect(parseColorWithAlpha('hsl(1 2)')).toBeNull()
    expect(parseColorWithAlpha('#12345')).toBeNull()
  })
})

describe('composite', () => {
  it('leaves an opaque colour unchanged', () => {
    expect(composite({ r: 10, g: 20, b: 30, a: 1 }, WHITE)).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('blends a half-transparent black onto white to mid grey', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({ r: 127.5, g: 127.5, b: 127.5 })
  })

  it('a fully transparent colour becomes the background', () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0 }, WHITE)).toEqual(WHITE)
  })
})

describe('conversions', () => {
  it('round-trips rgb -> hsl -> rgb', () => {
    const original: Rgb = { r: 64, g: 128, b: 192 }
    const back = hslToRgb(rgbToHsl(original))
    expect(back.r).toBeCloseTo(original.r, 0)
    expect(back.g).toBeCloseTo(original.g, 0)
    expect(back.b).toBeCloseTo(original.b, 0)
  })

  it('maps white to zero saturation and full lightness', () => {
    const hsl = rgbToHsl(WHITE)
    expect(hsl.s).toBe(0)
    expect(Math.round(hsl.l)).toBe(100)
  })

  it('formats hex with padding', () => {
    expect(toHex({ r: 1, g: 2, b: 3 })).toBe('#010203')
    expect(toHex(WHITE)).toBe('#ffffff')
  })

  it('formats hex with alpha only when translucent', () => {
    expect(formatHex({ r: 0, g: 0, b: 0, a: 1 })).toBe('#000000')
    expect(formatHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080')
  })

  it('formats rgb and hsl strings', () => {
    expect(formatRgb({ r: 1, g: 2, b: 3 })).toBe('rgb(1 2 3)')
    expect(formatHsl({ h: 180.4, s: 50.6, l: 25.2 })).toBe('hsl(180 51% 25%)')
  })

  it('formats rgba only when translucent', () => {
    expect(formatRgba({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1 2 3)')
    expect(formatRgba({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1 2 3 / 0.5)')
  })
})

describe('contrast', () => {
  it('gives 21:1 for black on white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 0)
  })

  it('gives 1:1 for identical colours', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    const a: Rgb = { r: 10, g: 20, b: 30 }
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10)
  })

  it('computes relative luminance extremes', () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5)
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5)
  })

  it('passes all checks for black on white', () => {
    expect(evaluateContrast(BLACK, WHITE)).toEqual({
      ratio: expect.any(Number),
      aaNormal: true,
      aaLarge: true,
      aaaNormal: true,
      aaaLarge: true,
    })
  })

  it('fails every check for near-identical colours', () => {
    const a: Rgb = { r: 128, g: 128, b: 128 }
    const b: Rgb = { r: 130, g: 130, b: 130 }
    const result = evaluateContrast(a, b)
    expect(result.aaNormal).toBe(false)
    expect(result.aaaLarge).toBe(false)
  })

  it('sits on the AA boundary exactly', () => {
    // #767676 on white is the canonical 4.54:1 "just passes AA" grey.
    const grey: Rgb = { r: 0x76, g: 0x76, b: 0x76 }
    expect(evaluateContrast(grey, WHITE).aaNormal).toBe(true)
  })
})

describe('contrastVerdict', () => {
  it('names the strongest level passed', () => {
    expect(contrastVerdict(evaluateContrast(BLACK, WHITE))).toMatch(/AAA/)
    expect(contrastVerdict(evaluateContrast({ r: 0x94, g: 0x94, b: 0x94 }, WHITE))).toMatch(/large text only/)
    expect(contrastVerdict(evaluateContrast({ r: 128, g: 128, b: 128 }, { r: 130, g: 130, b: 130 }))).toMatch(/Fails/)
  })
})

describe('alpha-aware contrast', () => {
  it('a half-transparent black over white is not the same as solid black', () => {
    const fg: Rgba = { r: 0, g: 0, b: 0, a: 0.5 }
    const flattened = composite(fg, WHITE)
    const ratio = contrastRatio(flattened, WHITE)
    expect(ratio).toBeLessThan(contrastRatio(BLACK, WHITE))
    expect(ratio).toBeGreaterThan(1)
  })
})

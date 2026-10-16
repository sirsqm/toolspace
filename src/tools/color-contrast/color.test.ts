import { describe, expect, it } from 'vitest'
import { bestTextColor, ColorError, composite, contrastRatio, flattenPair, hslToRgb, mix, parseColor, peakContrast, relativeLuminance, report, suggestForeground, suggestions, toHex, toHsl, toHslString, toRgbString, verdictSentence, wcagLevel } from './color'

const white = parseColor('#ffffff')
const black = parseColor('#000000')

describe('parseColor', () => {
  it('parses long and short hex', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('00ff00')).toEqual({ r: 0, g: 255, b: 0, a: 1 })
  })

  it('parses hex with alpha', () => {
    expect(parseColor('#ff000080').a).toBeCloseTo(0.502, 2)
    expect(parseColor('#f008').a).toBeCloseTo(0.533, 2)
  })

  it('parses rgb and rgba', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
  })

  it('parses hsl and hsla', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('hsla(120, 100%, 25%, 0.5)').a).toBe(0.5)
  })

  it('clamps channels out of range', () => {
    expect(parseColor('rgb(300, -20, 128)')).toEqual({ r: 255, g: 0, b: 128, a: 1 })
  })

  it('rejects nonsense', () => {
    expect(() => parseColor('')).toThrow(ColorError)
    expect(() => parseColor('not-a-colour')).toThrow(ColorError)
    expect(() => parseColor('#12345')).toThrow(ColorError)
  })

  it('rejects channels with no numeric value', () => {
    expect(() => parseColor('rgb(., 2, 3)')).toThrow(ColorError)
    expect(() => parseColor('rgb(1, 2, .)')).toThrow(ColorError)
    expect(() => parseColor('hsl(., 100%, 50%)')).toThrow(ColorError)
    expect(() => parseColor('rgb(1, 2, 3, .)')).toThrow(ColorError)
  })

  it('never yields NaN channels', () => {
    for (const input of ['rgb(1.2.3, 2, 3)', 'rgb(--1, 2, 3)']) {
      expect(() => parseColor(input)).toThrow(ColorError)
    }
  })

  it('shortens an oversized token in the error rather than echoing it whole', () => {
    const huge = `rgb(${'1.2.'.repeat(60)}3, 2, 3)`
    try {
      parseColor(huge)
      throw new Error('expected parseColor to throw')
    } catch (err) {
      const message = (err as Error).message
      expect(message.length).toBeLessThan(60)
      expect(message).toContain('…')
    }
  })
})

describe('conversions', () => {
  it('round-trips through hex', () => {
    expect(toHex(parseColor('rgb(18, 52, 86)'))).toBe('#123456')
    expect(toHex(parseColor('#ff000080'))).toBe('#ff000080')
  })

  it('writes rgb strings', () => {
    expect(toRgbString(parseColor('#123456'))).toBe('rgb(18, 52, 86)')
    expect(toRgbString(parseColor('rgba(1,2,3,0.5)'))).toBe('rgba(1, 2, 3, 0.5)')
  })

  it('converts to hsl', () => {
    const hsl = toHsl(parseColor('#ff0000'))
    expect(hsl.h).toBe(0)
    expect(hsl.s).toBe(100)
    expect(hsl.l).toBe(50)
    expect(toHslString(parseColor('#00ff00'))).toBe('hsl(120, 100%, 50%)')
  })

  it('round-trips hsl to rgb', () => {
    expect(hslToRgb({ h: 240, s: 100, l: 50, a: 1 })).toEqual({ r: 0, g: 0, b: 255, a: 1 })
    expect(hslToRgb({ h: 0, s: 0, l: 0, a: 1 })).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })

  it('handles achromatic colours', () => {
    expect(toHsl(parseColor('#808080')).s).toBe(0)
  })
})

describe('composite / mix', () => {
  it('composites alpha over a backdrop', () => {
    const result = composite({ r: 0, g: 0, b: 0, a: 0.5 }, white)
    expect(result.r).toBeCloseTo(127.5)
    expect(result.a).toBe(1)
  })

  it('returns the front colour when fully opaque', () => {
    expect(composite({ r: 10, g: 20, b: 30, a: 1 }, white)).toEqual({ r: 10, g: 20, b: 30, a: 1 })
  })

  it('mixes two colours', () => {
    expect(mix(black, white, 0.5).r).toBe(128)
    expect(mix(black, white, 0)).toEqual(black)
    expect(mix(black, white, 1)).toEqual(white)
  })
})

describe('relativeLuminance', () => {
  it('is zero for black and one for white', () => {
    expect(relativeLuminance(black)).toBe(0)
    expect(relativeLuminance(white)).toBe(1)
  })

  it('uses the linear segment for very dark colours', () => {
    // rgb(10,10,10) is below the 0.03928 cut-off.
    expect(relativeLuminance(parseColor('#0a0a0a'))).toBeCloseTo(0.003035, 6)
  })
})

describe('contrastRatio', () => {
  it('gives 21 for black on white', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
  })

  it('gives 1 for a colour against itself', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    const a = parseColor('#123456')
    const b = parseColor('#abcdef')
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('composites a translucent colour first', () => {
    const translucent = { r: 0, g: 0, b: 0, a: 0.5 }
    const ratio = contrastRatio(translucent, white)
    const expected = contrastRatio(composite(translucent, white), white)
    expect(ratio).toBeCloseTo(expected, 10)
  })
})

describe('wcagLevel', () => {
  it('classifies normal text', () => {
    expect(wcagLevel(21)).toBe('AAA')
    expect(wcagLevel(5)).toBe('AA')
    expect(wcagLevel(3.5)).toBe('AA Large')
    expect(wcagLevel(2)).toBe('Fail')
  })

  it('relaxes the thresholds for large text', () => {
    expect(wcagLevel(4.5, true)).toBe('AAA')
    expect(wcagLevel(3.1, true)).toBe('AA')
    expect(wcagLevel(2.9, true)).toBe('Fail')
  })
})

describe('report', () => {
  it('summarises a strong pairing', () => {
    const result = report(black, white)
    expect(result.ratio).toBeCloseTo(21, 5)
    expect(result.normal).toBe('AAA')
    expect(result.normalPass).toBe(true)
    expect(result.aaaPass).toBe(true)
  })

  it('summarises a weak pairing', () => {
    const result = report(parseColor('#999999'), white)
    expect(result.normalPass).toBe(false)
    expect(result.largePass).toBe(false)
  })

  it('passes large text when normal text fails', () => {
    // #777777 on white is about 4.48:1, enough for large text but not body copy.
    const result = report(parseColor('#777777'), white)
    expect(result.normalPass).toBe(false)
    expect(result.largePass).toBe(true)
  })

  it('flattens a translucent background onto the page before measuring', () => {
    const translucentBg = { r: 0, g: 0, b: 0, a: 0.5 }
    const flat = report(parseColor('#000000'), translucentBg)
    const painted = contrastRatio(parseColor('#000000'), composite(translucentBg, white))
    expect(flat.ratio).toBeCloseTo(painted, 10)
  })

  it('flattens the background first, then the foreground, through flattenPair', () => {
    const ratio = flattenPair({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 0.5 })
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(21)
  })
})

describe('bestTextColor', () => {
  it('picks black on light backgrounds', () => {
    expect(bestTextColor(white).r).toBe(0)
  })

  it('picks white on dark backgrounds', () => {
    expect(bestTextColor(parseColor('#111111')).r).toBe(255)
  })
})

describe('suggestForeground', () => {
  it('returns the input when it already passes', () => {
    expect(suggestForeground(black, white, 4.5)).toEqual(black)
  })

  it('darkens a light colour on a light background', () => {
    const suggestion = suggestForeground(parseColor('#aaaaaa'), white, 4.5)
    expect(contrastRatio(suggestion, white)).toBeGreaterThanOrEqual(4.5)
    expect(relativeLuminance(suggestion)).toBeLessThan(relativeLuminance(parseColor('#aaaaaa')))
  })

  it('lightens a dark colour on a dark background', () => {
    const suggestion = suggestForeground(parseColor('#333333'), black, 4.5)
    expect(contrastRatio(suggestion, black)).toBeGreaterThanOrEqual(4.5)
  })

  it('reaches the target on a mid-tone background', () => {
    // On #808080 the only passing direction is darker. Picking a direction
    // from the background luminance alone returns a failing colour.
    const background = parseColor('#808080')
    const suggestion = suggestForeground(parseColor('#aaaaaa'), background, 4.5)
    expect(contrastRatio(suggestion, background)).toBeGreaterThanOrEqual(4.5)
  })

  it('honours a custom target', () => {
    const suggestion = suggestForeground(parseColor('#bbbbbb'), white, 7)
    expect(contrastRatio(suggestion, white)).toBeGreaterThanOrEqual(7)
  })
})

describe('verdictSentence', () => {
  it('states the level a ratio reaches', () => {
    expect(verdictSentence(report(black, white))).toMatch(/passes AAA/)
    expect(verdictSentence(report(parseColor('#767676'), white))).toMatch(/passes AA/)
    expect(verdictSentence(report(parseColor('#949494'), white))).toMatch(/large text/)
    expect(verdictSentence(report(parseColor('#b0b0b0'), white))).toMatch(/fails every level/)
  })

  it('names the threshold that is still missing', () => {
    expect(verdictSentence(report(parseColor('#767676'), white))).toContain('7:1')
    expect(verdictSentence(report(parseColor('#949494'), white))).toContain('4.5:1')
    expect(verdictSentence(report(parseColor('#b0b0b0'), white))).toContain('3:1')
  })
})

describe('suggestions', () => {
  it('only offers colours that reach the target', () => {
    const list = suggestions(parseColor('#aaaaaa'), white)
    expect(list.length).toBeGreaterThan(0)
    for (const item of list) expect(item.ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('deduplicates identical colours', () => {
    const hexes = suggestions(black, white).map((item) => `${item.color.r},${item.color.g},${item.color.b}`)
    expect(new Set(hexes).size).toBe(hexes.length)
  })

  it('marks the AA body-text pass', () => {
    for (const item of suggestions(parseColor('#aaaaaa'), white)) {
      expect(item.passes).toBe(contrastRatio(item.color, white) >= 4.5)
    }
  })

  it('always offers black or white, so the list is never empty', () => {
    for (const background of ['#ffffff', '#000000', '#808080', '#123456', '#fefefe']) {
      const list = suggestions(parseColor('#aaaaaa'), parseColor(background))
      expect(list.length).toBeGreaterThan(0)
      const hasExtreme = list.some(
        (item) => (item.color.r === 0 && item.color.g === 0 && item.color.b === 0) || (item.color.r === 255 && item.color.g === 255 && item.color.b === 255),
      )
      expect(hasExtreme).toBe(true)
    }
  })

  it('labels the nearest nudge in plain words', () => {
    const list = suggestions(parseColor('#aaaaaa'), white)
    expect(list.some((item) => item.label === 'Closest passing')).toBe(true)
  })

  it('honours a stricter custom target', () => {
    const list = suggestions(parseColor('#aaaaaa'), white, 7)
    expect(list.length).toBeGreaterThan(0)
    for (const item of list) {
      expect(item.ratio).toBeGreaterThanOrEqual(7)
      expect(item.passes).toBe(true)
    }
  })

  it('can legitimately be empty when the target is out of reach', () => {
    // A mid-grey background tops out around 5.3:1, so nothing reaches 7:1.
    const background = parseColor('#808080')
    expect(peakContrast(background)).toBeLessThan(7)
    expect(suggestions(parseColor('#cccccc'), background, 7)).toEqual([])
  })
})

describe('peakContrast', () => {
  it('is reached by an extreme, never beaten by one', () => {
    for (const hex of ['#ffffff', '#000000', '#808080', '#123456', '#d0e0f0']) {
      const background = parseColor(hex)
      const ceiling = peakContrast(background)
      expect(ceiling).toBeGreaterThanOrEqual(flattenPair(black, background))
      expect(ceiling).toBeGreaterThanOrEqual(flattenPair(white, background))
      expect(ceiling).toBeLessThanOrEqual(21)
    }
  })

  it('agrees with the better of black and white', () => {
    const background = parseColor('#336699')
    const ceiling = peakContrast(background)
    expect(ceiling).toBeCloseTo(Math.max(flattenPair(black, background), flattenPair(white, background)), 10)
  })
})

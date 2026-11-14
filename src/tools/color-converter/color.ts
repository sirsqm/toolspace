/**
 * Colour conversion and WCAG contrast, implemented from scratch so there is
 * no dependency to load and every value is testable in isolation.
 *
 * Two colour forms are supported end to end: the opaque `Rgb` form and an
 * alpha-carrying `Rgba` form. The alpha-aware path matters for contrast —
 * `rgba(0,0,0,0.5)` over white is a different pair to `#000` over white, so
 * reporting the same ratio for both would be wrong. Alpha is composited onto
 * the background before the ratio is measured, exactly as a browser paints it.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Rgba extends Rgb {
  /** 0 (transparent) to 1 (opaque). */
  a: number
}

export interface Hsl {
  h: number
  s: number
  l: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * Hex for an `Rgba`: the eight-digit form only when the colour is translucent,
 * so an opaque colour still reads as the familiar `#rrggbb`.
 */
export function formatHex({ r, g, b, a }: Rgba): string {
  const alpha = clamp(a, 0, 1)
  const base = toHex({ r, g, b })
  if (alpha >= 1) return base
  return `${base}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`
}

/** Parse a 0–255 channel that may be given as a percentage. */
function parseChannel(token: string): number | null {
  if (token.endsWith('%')) {
    const pct = Number(token.slice(0, -1))
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null
    return Math.round((pct / 100) * 255)
  }
  const value = Number(token)
  if (!Number.isFinite(value) || value < 0 || value > 255) return null
  return Math.round(value)
}

/** Parse a 0–1 alpha that may be given as a percentage. */
function parseAlpha(token: string): number | null {
  const value = token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token)
  if (!Number.isFinite(value) || value < 0 || value > 1) return null
  return value
}

/** Parse an angle, tolerating a trailing `deg`. */
function parseAngle(token: string): number | null {
  const value = token.endsWith('deg') ? Number(token.slice(0, -3)) : Number(token)
  return Number.isFinite(value) ? value : null
}

/** Parse a 0–100 percentage; a bare number is accepted for convenience. */
function parsePercent(token: string): number | null {
  const value = token.endsWith('%') ? Number(token.slice(0, -1)) : Number(token)
  if (!Number.isFinite(value) || value < 0 || value > 100) return null
  return value
}

export const NAMED_COLORS: Record<string, number> = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4,
  azure: 0xf0ffff, beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000,
  blanchedalmond: 0xffebcd, blue: 0x0000ff, blueviolet: 0x8a2be2, brown: 0xa52a2a,
  burlywood: 0xdeb887, cadetblue: 0x5f9ea0, chartreuse: 0x7fff00, chocolate: 0xd2691e,
  coral: 0xff7f50, cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c,
  cyan: 0x00ffff, darkblue: 0x00008b, darkcyan: 0x008b8b, darkgoldenrod: 0xb8860b,
  darkgray: 0xa9a9a9, darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b,
  darkmagenta: 0x8b008b, darkolivegreen: 0x556b2f, darkorange: 0xff8c00, darkorchid: 0x9932cc,
  darkred: 0x8b0000, darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f, darkslateblue: 0x483d8b,
  darkslategray: 0x2f4f4f, darkslategrey: 0x2f4f4f, darkturquoise: 0x00ced1, darkviolet: 0x9400d3,
  deeppink: 0xff1493, deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969,
  dodgerblue: 0x1e90ff, firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22,
  fuchsia: 0xff00ff, gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700,
  goldenrod: 0xdaa520, gray: 0x808080, green: 0x008000, greenyellow: 0xadff2f,
  grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4, indianred: 0xcd5c5c,
  indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6,
  lightcoral: 0xf08080, lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2, lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90, lightgrey: 0xd3d3d3, lightpink: 0xffb6c1, lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa, lightslategray: 0x778899, lightslategrey: 0x778899,
  lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00, limegreen: 0x32cd32,
  linen: 0xfaf0e6, magenta: 0xff00ff, maroon: 0x800000, mediumaquamarine: 0x66cdaa,
  mediumblue: 0x0000cd, mediumorchid: 0xba55d3, mediumpurple: 0x9370db, mediumseagreen: 0x3cb371,
  mediumslateblue: 0x7b68ee, mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585,
  midnightblue: 0x191970, mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5,
  navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000,
  olivedrab: 0x6b8e23, orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6,
  palegoldenrod: 0xeee8aa, palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093,
  papayawhip: 0xffefd5, peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb,
  plum: 0xdda0dd, powderblue: 0xb0e0e6, purple: 0x800080, rebeccapurple: 0x663399,
  red: 0xff0000, rosybrown: 0xbc8f8f, royalblue: 0x4169e1, saddlebrown: 0x8b4513,
  salmon: 0xfa8072, sandybrown: 0xf4a460, seagreen: 0x2e8b57, seashell: 0xfff5ee,
  sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb, slateblue: 0x6a5acd,
  slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa, springgreen: 0x00ff7f,
  steelblue: 0x4682b4, tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8,
  tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee, wheat: 0xf5deb3,
  white: 0xffffff, whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
}

/**
 * Resolve a CSS colour keyword to an `Rgba`: every named colour, plus
 * `transparent` (which is `rgba(0,0,0,0)`). Returns `null` for anything the
 * browser would not accept, including context-dependent keywords such as
 * `currentcolor`.
 */
export function parseNamedColor(input: string): Rgba | null {
  const name = input.trim().toLowerCase()
  if (name === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  const packed = NAMED_COLORS[name]
  if (packed === undefined) return null
  return { r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff, a: 1 }
}

const HEX = /^#?([0-9a-f]{3,8})$/i
const FUNCTIONAL = /^(rgba?|hsla?)\(([^)]*)\)$/i

/**
 * Parse every common CSS colour syntax into an `Rgba`, or `null`.
 *
 * Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` (with or without the hash),
 * `rgb()` / `rgba()` with comma or space separators and optional percentages,
 * `hsl()` / `hsla()` with a slash alpha, and the CSS colour keywords including
 * `transparent`. Out-of-range channels are rejected rather than clamped, so a
 * typo surfaces instead of silently producing the wrong colour.
 */
export function parseColorWithAlpha(input: string): Rgba | null {
  const value = input.trim().toLowerCase()
  if (!value) return null

  const hex = HEX.exec(value)
  if (hex) {
    const digits = hex[1]
    if (digits.length === 3 || digits.length === 4) {
      const parts = [...digits].map((digit) => parseInt(digit + digit, 16))
      return { r: parts[0], g: parts[1], b: parts[2], a: digits.length === 4 ? parts[3] / 255 : 1 }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      }
    }
    return null
  }

  const named = parseNamedColor(value)
  if (named) return named

  const fn = FUNCTIONAL.exec(value)
  if (!fn) return null
  const parts = fn[2].replace(/[/,]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const alpha = parts.length === 4 ? parseAlpha(parts[3]) : 1
  if (alpha === null) return null

  if (fn[1].startsWith('rgb')) {
    if (parts.length !== 3 && parts.length !== 4) return null
    const r = parseChannel(parts[0])
    const g = parseChannel(parts[1])
    const b = parseChannel(parts[2])
    if (r === null || g === null || b === null) return null
    return { r, g, b, a: alpha }
  }

  if (parts.length !== 3 && parts.length !== 4) return null
  const h = parseAngle(parts[0])
  const s = parsePercent(parts[1])
  const l = parsePercent(parts[2])
  if (h === null || s === null || l === null) return null
  const { r, g, b } = hslToRgb({ h, s, l })
  return { r, g, b, a: alpha }
}

/** Parse `#rgb`, `#rrggbb`, `rgb(…)`, `hsl(…)` or a bare hex string, ignoring alpha. */
export function parseColor(input: string): Rgb | null {
  const rgba = parseColorWithAlpha(input)
  return rgba ? { r: rgba.r, g: rgba.g, b: rgba.b } : null
}

/**
 * Flatten a translucent foreground onto an opaque background, as the browser
 * would paint it. An opaque foreground comes back unchanged.
 */
export function composite(foreground: Rgba, background: Rgb): Rgb {
  const alpha = clamp(foreground.a, 0, 1)
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  }
}

/** Opaque hex of a translucent colour after it is painted onto a background. */
export function paintedHex(foreground: Rgba, background: Rgb): string {
  return toHex(composite(foreground, background))
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  let h = 0
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6
    else if (max === gn) h = (bn - rn) / delta + 2
    else h = (rn - gn) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  return { h, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))

  let rgb: [number, number, number] = [0, 0, 0]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]

  const m = ln - c / 2
  return { r: Math.round((rgb[0] + m) * 255), g: Math.round((rgb[1] + m) * 255), b: Math.round((rgb[2] + m) * 255) }
}

/** sRGB channel to linear light, per the WCAG relative luminance definition. */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b)
}

/** WCAG 2.1 contrast ratio, from 1 (identical) to 21 (black on white). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

export interface ContrastResult {
  ratio: number
  /** 4.5:1 for normal text, 3:1 for large text — both at AA. */
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  aaaLarge: boolean
}

export function evaluateContrast(foreground: Rgb, background: Rgb): ContrastResult {
  const ratio = contrastRatio(foreground, background)
  return {
    ratio,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  }
}

/** One plain sentence naming the strongest level the pair actually passes. */
export function contrastVerdict(result: ContrastResult): string {
  if (result.aaaNormal) return 'Passes AAA at every text size.'
  if (result.aaNormal) return 'Passes AA for body text, and AAA for large text.'
  if (result.aaLarge) return 'Passes AA for large text only (18pt, or 14pt bold).'
  return 'Fails every WCAG level — raise the contrast.'
}

export function formatHsl({ h, s, l }: Hsl): string {
  return `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%)`
}

export function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${r} ${g} ${b})`
}

/** `rgb(r g b)` when opaque, `rgba(r g b / a)` when translucent. */
export function formatRgba({ r, g, b, a }: Rgba): string {
  const alpha = Number(clamp(a, 0, 1).toFixed(3))
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgba(${r} ${g} ${b} / ${alpha})`
}

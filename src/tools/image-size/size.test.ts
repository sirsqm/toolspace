import { describe, expect, it } from 'vitest'
import {
  aspect,
  fitWithin,
  formatBytes,
  inspectImage,
  nearestCommonRatio,
  readDimensions,
  scaleByPercent,
} from './size'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function fromHex(hex: string): Uint8Array {
  return bytes(...(hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)))
}

function le16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff]
}

function le32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

describe('readDimensions', () => {
  it('reads a PNG', () => {
    // 800 x 600 stored big-endian at offsets 16 and 20.
    const png = fromHex('89504e470d0a1a0a0000000d494844520000032000000258')
    expect(readDimensions(png)).toEqual({ width: 800, height: 600, format: 'PNG', mime: 'image/png' })
  })

  it('reads a GIF', () => {
    const gif = fromHex('4749463839614001f000')
    expect(readDimensions(gif)).toEqual({ width: 320, height: 240, format: 'GIF', mime: 'image/gif' })
  })

  it('reads a BMP and takes the height as a magnitude', () => {
    // 'BM', then the file header, then a 40-byte DIB header with width 320 and
    // a negative height, which BMP uses for top-down images.
    const bmp = bytes(0x42, 0x4d, ...le32(0), ...le32(0), ...le32(54), ...le32(40), ...le32(320), ...le32(-240), ...le16(1), ...le16(24))
    expect(readDimensions(bmp)).toMatchObject({ width: 320, height: 240, format: 'BMP' })
  })

  it('reads a JPEG start-of-frame', () => {
    // SOI, then SOF0: length, precision, height 600, width 800.
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xc0, ...be16(17), 0x08, ...be16(600), ...be16(800), 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01)
    expect(readDimensions(jpeg)).toMatchObject({ width: 800, height: 600, format: 'JPEG' })
  })

  it('reads a lossless WebP', () => {
    // VP8L with a packed 100 x 50 size in the 28 bits after the signature.
    const bits = (99 & 0x3fff) | ((49 & 0x3fff) << 14)
    const header = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 12, 0, 0, 0, 0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]
    expect(readDimensions(bytes(...header))).toEqual({ width: 100, height: 50, format: 'WebP (lossless)', mime: 'image/webp' })
  })

  it('reads an ICO where zero means 256', () => {
    expect(readDimensions(fromHex('0000010001000000000001001800000000'))).toMatchObject({ width: 256, height: 256, format: 'ICO' })
  })

  it('reads a little-endian TIFF', () => {
    // IFD at offset 8 with two SHORT entries for width 320 and height 240.
    const tiff = bytes(
      0x49, 0x49, 0x2a, 0x00, ...le32(8),
      ...le16(2),
      ...le16(0x0100), ...le16(3), ...le32(1), ...le16(320), ...le16(0),
      ...le16(0x0101), ...le16(3), ...le32(1), ...le16(240), ...le16(0),
      ...le32(0),
    )
    expect(readDimensions(tiff)).toMatchObject({ width: 320, height: 240, format: 'TIFF' })
  })

  it('returns null for unknown, empty and truncated input', () => {
    expect(readDimensions(bytes(1, 2, 3, 4, 5))).toBeNull()
    expect(readDimensions(bytes())).toBeNull()
    expect(readDimensions(fromHex('89504e47'))).toBeNull()
  })

  it('returns null for a JPEG with no frame header', () => {
    expect(readDimensions(fromHex('ffd8ffd9'))).toBeNull()
  })
})

describe('formatBytes', () => {
  it('formats small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('scales to larger units', () => {
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB')
  })

  it('rejects nonsense', () => {
    expect(() => formatBytes(-1)).toThrow()
    expect(() => formatBytes(Number.NaN)).toThrow()
  })
})

describe('aspect', () => {
  it('reduces the ratio', () => {
    expect(aspect(1920, 1080).ratio).toBe('16:9')
    expect(aspect(800, 600).ratio).toBe('4:3')
    expect(aspect(100, 100).ratio).toBe('1:1')
  })

  it('labels the orientation', () => {
    expect(aspect(1920, 1080).orientation).toBe('landscape')
    expect(aspect(1080, 1920).orientation).toBe('portrait')
    expect(aspect(500, 500).orientation).toBe('square')
  })

  it('reports megapixels and the decimal ratio', () => {
    const info = aspect(4000, 3000)
    expect(info.megapixels).toBe(12)
    expect(info.decimal).toBeCloseTo(1.3333, 3)
  })

  it('rejects zero and negative sizes', () => {
    expect(() => aspect(0, 100)).toThrow()
    expect(() => aspect(100, -1)).toThrow()
  })
})

describe('fitWithin', () => {
  it('scales down keeping the ratio', () => {
    expect(fitWithin(1920, 1080, 960, 960)).toEqual({ width: 960, height: 540 })
  })

  it('leaves a smaller image alone', () => {
    expect(fitWithin(100, 50, 1000, 1000)).toEqual({ width: 100, height: 50 })
  })

  it('rejects non-positive limits', () => {
    expect(() => fitWithin(100, 100, 0, 100)).toThrow()
  })
})

describe('nearestCommonRatio', () => {
  it('names an exact shape and offers the size at that shape', () => {
    const ratio = nearestCommonRatio(1920, 1080)
    expect(ratio?.label).toBe('16:9')
    expect(ratio?.width).toBe(1920)
    expect(ratio?.height).toBe(1080)
    expect(ratio?.deviation).toBe(0)
  })

  it('keeps the longer side for a portrait image', () => {
    expect(nearestCommonRatio(1080, 1920)).toMatchObject({ label: '9:16', width: 1080, height: 1920 })
  })

  it('accepts a near miss inside the tolerance', () => {
    expect(nearestCommonRatio(1918, 1080)?.label).toBe('16:9')
  })

  it('picks the closest shape when two are in range', () => {
    // 1200 x 630 is the standard Open Graph card, which is its own shape.
    expect(nearestCommonRatio(1200, 630, 0.1)?.label).toBe('1.91:1')
  })

  it('returns null when nothing is close', () => {
    expect(nearestCommonRatio(1000, 333)).toBeNull()
  })

  it('returns null for a size that is not usable', () => {
    expect(nearestCommonRatio(0, 100)).toBeNull()
    expect(nearestCommonRatio(Number.NaN, 100)).toBeNull()
    expect(nearestCommonRatio(100, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('rejects a negative tolerance', () => {
    expect(() => nearestCommonRatio(100, 100, -1)).toThrow()
  })
})

describe('scaleByPercent', () => {
  it('scales both sides', () => {
    expect(scaleByPercent(1920, 1080, 50)).toEqual({ width: 960, height: 540 })
    expect(scaleByPercent(1920, 1080, 25)).toEqual({ width: 480, height: 270 })
  })

  it('never rounds a side away to zero', () => {
    expect(scaleByPercent(10, 1, 1)).toEqual({ width: 1, height: 1 })
    expect(scaleByPercent(1, 1, 0.5)).toEqual({ width: 1, height: 1 })
  })

  it('rejects a scale of zero or less', () => {
    expect(() => scaleByPercent(100, 100, 0)).toThrow()
    expect(() => scaleByPercent(100, 100, -5)).toThrow()
    expect(() => scaleByPercent(100, 100, Number.NaN)).toThrow()
  })
})

describe('inspectImage', () => {
  function png(width: number, height: number): Uint8Array {
    const data = new Uint8Array(24)
    data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(data.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return data
  }

  it('reads a good header', () => {
    expect(inspectImage(png(800, 600))).toEqual({
      ok: true,
      info: { width: 800, height: 600, format: 'PNG', mime: 'image/png' },
    })
  })

  it('names an empty file', () => {
    const read = inspectImage(new Uint8Array(0))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problem.reason).toMatch(/empty/i)
  })

  it('names an unknown format', () => {
    const read = inspectImage(new TextEncoder().encode('not an image at all, just text'))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problem.reason).toMatch(/does not match any format/i)
  })

  it('refuses a header that claims a zero side instead of throwing', () => {
    const read = inspectImage(png(0, 600))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problem.reason).toContain('0 × 600')
  })

  it('refuses an absurd claimed size', () => {
    const read = inspectImage(png(4_294_967_295, 600))
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.problem.reason).toMatch(/larger than any real image/i)
  })

  it('does not throw on a truncated AVIF header', () => {
    const data = new Uint8Array(20)
    data.set(new TextEncoder().encode('ftyp'), 4)
    data.set(new TextEncoder().encode('avif'), 8)
    data.set(new TextEncoder().encode('ispe'), 16)
    expect(() => inspectImage(data)).not.toThrow()
    expect(inspectImage(data).ok).toBe(false)
  })

  it('keeps readDimensions as the thin form', () => {
    expect(readDimensions(png(800, 600))?.width).toBe(800)
    expect(readDimensions(png(0, 600))).toBeNull()
    expect(readDimensions(new Uint8Array(0))).toBeNull()
  })
})

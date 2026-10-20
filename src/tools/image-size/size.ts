/**
 * Image dimensions read from the file header.
 *
 * Only the few bytes each format needs are read, so this works on large files
 * without decoding them. Every reader bounds-checks its offsets and returns
 * null rather than throwing, because a truncated file is a normal input here.
 */

export interface ImageDimensions {
  width: number
  height: number
  format: string
  mime: string
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readAscii(bytes: Uint8Array, at: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i] ?? 0)
  return out
}

function has(bytes: Uint8Array, at: number, pattern: number[]): boolean {
  if (at + pattern.length > bytes.length) return false
  return pattern.every((value, index) => bytes[at + index] === value)
}

function png(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0x89, 0x50, 0x4e, 0x47]) || bytes.length < 24) return null
  const data = view(bytes)
  return { width: data.getUint32(16), height: data.getUint32(20), format: 'PNG', mime: 'image/png' }
}

function gif(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0x47, 0x49, 0x46, 0x38]) || bytes.length < 10) return null
  const data = view(bytes)
  return { width: data.getUint16(6, true), height: data.getUint16(8, true), format: 'GIF', mime: 'image/gif' }
}

function bmp(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0x42, 0x4d]) || bytes.length < 26) return null
  const data = view(bytes)
  return { width: data.getInt32(18, true), height: Math.abs(data.getInt32(22, true)), format: 'BMP', mime: 'image/bmp' }
}

function webp(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || readAscii(bytes, 8, 4) !== 'WEBP') return null
  const chunk = readAscii(bytes, 12, 4)
  const data = view(bytes)
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return { width, height, format: 'WebP (extended)', mime: 'image/webp' }
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff, format: 'WebP', mime: 'image/webp' }
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'WebP (lossless)', mime: 'image/webp' }
  }
  return null
}

/** Walk the JPEG marker segments until a start-of-frame carries the size. */
function jpeg(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0xff, 0xd8])) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
    if (isFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
      return { width, height, format: 'JPEG', mime: 'image/jpeg' }
    }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

function ico(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0x00, 0x00, 0x01, 0x00]) || bytes.length < 8) return null
  // Zero means 256 in the ICO header.
  return { width: bytes[6] || 256, height: bytes[7] || 256, format: 'ICO', mime: 'image/x-icon' }
}

function tiff(bytes: Uint8Array): ImageDimensions | null {
  if (!has(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) && !has(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) return null
  const little = bytes[0] === 0x49
  const data = view(bytes)
  const ifd = data.getUint32(4, little)
  if (ifd + 2 > bytes.length) return null
  const count = data.getUint16(ifd, little)
  let width = 0
  let height = 0
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > bytes.length) break
    const tag = data.getUint16(entry, little)
    const type = data.getUint16(entry + 2, little)
    const short = type === 3
    const value = short ? data.getUint16(entry + 8, little) : data.getUint32(entry + 8, little)
    if (tag === 0x0100) width = value
    if (tag === 0x0101) height = value
  }
  if (!width || !height) return null
  return { width, height, format: 'TIFF', mime: 'image/tiff' }
}

function avif(bytes: Uint8Array): ImageDimensions | null {
  if (readAscii(bytes, 4, 4) !== 'ftyp') return null
  const brand = readAscii(bytes, 8, 4)
  if (brand !== 'avif' && brand !== 'avis') return null
  const data = view(bytes)
  // The ispe box holds the pixel dimensions, but its position varies, so scan
  // for the box type and read the two uint32 values that follow. The loop bound
  // covers the 16 bytes that read needs; a shorter bound read past the end of a
  // truncated file and threw a RangeError out of a function that never throws.
  for (let i = 0; i + 16 <= bytes.length; i++) {
    if (readAscii(bytes, i, 4) === 'ispe') {
      return { width: data.getUint32(i + 8), height: data.getUint32(i + 12), format: 'AVIF', mime: 'image/avif' }
    }
  }
  return null
}

export interface ImageProblem {
  /** What is wrong, in one sentence. */
  reason: string
  /** What the reader can do about it. */
  hint: string
}

export type ImageRead = { ok: true; info: ImageDimensions } | { ok: false; problem: ImageProblem }

/**
 * Read an image header, and say *why* when it cannot be read.
 *
 * `readDimensions` answers with a plain null, which left the tool with one
 * generic message for four different situations. This keeps the reason so the
 * page can tell an empty file from an unknown format from a damaged header.
 */
export function inspectImage(bytes: Uint8Array): ImageRead {
  if (bytes.length === 0) {
    return { ok: false, problem: { reason: 'That file is empty.', hint: 'Choose a file that has an image in it.' } }
  }
  const info =
    png(bytes) ?? gif(bytes) ?? jpeg(bytes) ?? webp(bytes) ?? bmp(bytes) ?? ico(bytes) ?? tiff(bytes) ?? avif(bytes)
  if (!info) {
    return {
      ok: false,
      problem: {
        reason: 'The file header does not match any format this tool reads.',
        hint: 'PNG, JPEG, GIF, WebP, BMP, ICO, TIFF and AVIF are supported. A renamed or corrupt file will not read, because the header is what carries the size.',
      },
    }
  }
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width <= 0 || info.height <= 0) {
    return {
      ok: false,
      problem: {
        reason: `The header claims a size of ${info.width} × ${info.height}, which is not a usable image size.`,
        hint: 'A header that is damaged or truncated like this cannot be trusted, so no dimensions are shown.',
      },
    }
  }
  if (info.width > 1_000_000 || info.height > 1_000_000) {
    return {
      ok: false,
      problem: {
        reason: `The header claims a size of ${info.width} × ${info.height}, which is larger than any real image.`,
        hint: 'The header is probably damaged. Nothing else in the file was read.',
      },
    }
  }
  return { ok: true, info }
}

/**
 * Try every reader and return the first result, or null.
 *
 * Kept as the thin form of `inspectImage` for callers that only want the size.
 */
export function readDimensions(bytes: Uint8Array): ImageDimensions | null {
  const read = inspectImage(bytes)
  return read.ok ? read.info : null
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Size must be a positive number')
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

export interface AspectInfo {
  ratio: string
  decimal: number
  orientation: 'landscape' | 'portrait' | 'square'
  megapixels: number
}

/** One of the shapes people actually mean when they say "16:9". */
export interface CommonRatio {
  label: string
  /** Width divided by height for this shape. */
  ratio: number
  /** The size at this shape that keeps the original's longer side. */
  width: number
  height: number
  /** Distance from the original shape as a fraction: 0.01 is one percent. */
  deviation: number
}

const COMMON_RATIOS: readonly [string, number, number][] = [
  ['1:1', 1, 1],
  ['5:4', 5, 4],
  ['4:3', 4, 3],
  ['3:2', 3, 2],
  ['16:10', 16, 10],
  ['16:9', 16, 9],
  ['1.91:1', 1.91, 1],
  ['21:9', 21, 9],
  ['3:4', 3, 4],
  ['2:3', 2, 3],
  ['9:16', 9, 16],
]

/**
 * The nearest well-known aspect ratio, or null when the image is not close to
 * any of them. The size offered keeps the original's longer side, so it is a
 * like-for-like crop or pad target rather than an arbitrary rescale.
 */
export function nearestCommonRatio(width: number, height: number, tolerance = 0.02): CommonRatio | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('The tolerance must be zero or more')
  const actual = width / height
  const longSide = Math.max(width, height)
  let best: CommonRatio | null = null
  for (const [label, ratioWidth, ratioHeight] of COMMON_RATIOS) {
    const ratio = ratioWidth / ratioHeight
    const deviation = Math.abs(actual - ratio) / ratio
    if (deviation > tolerance) continue
    const target =
      ratio >= 1
        ? { width: Math.round(longSide), height: Math.round(longSide / ratio) }
        : { width: Math.round(longSide * ratio), height: Math.round(longSide) }
    if (!best || deviation < best.deviation) best = { label, ratio, deviation, ...target }
  }
  return best
}

/** The sizes offered as one-click checks, and the "fit within" panel. */
export interface FitTarget {
  label: string
  width: number
  height: number
}

export const FIT_TARGETS: readonly FitTarget[] = [
  { label: 'Full HD', width: 1920, height: 1080 },
  { label: 'Open Graph card', width: 1200, height: 630 },
  { label: 'Twitter card', width: 1200, height: 675 },
  { label: 'Retina thumb', width: 512, height: 512 },
  { label: 'Favicon', width: 256, height: 256 },
]

/** Scale to a percentage of the original, keeping each side at least one pixel. */
export function scaleByPercent(width: number, height: number, percent: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Width and height must be positive')
  if (!Number.isFinite(percent) || percent <= 0) throw new Error('The scale must be greater than zero')
  return {
    width: Math.max(1, Math.round((width * percent) / 100)),
    height: Math.max(1, Math.round((height * percent) / 100)),
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Reduce the dimensions to a simple ratio and label the orientation. */
export function aspect(width: number, height: number): AspectInfo {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Width and height must be positive')
  const divisor = gcd(Math.round(width), Math.round(height)) || 1
  return {
    ratio: `${Math.round(width) / divisor}:${Math.round(height) / divisor}`,
    decimal: width / height,
    orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square',
    megapixels: (width * height) / 1_000_000,
  }
}

/** Sizes that fit inside the original while keeping the ratio. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) throw new Error('Every dimension must be positive')
  // Fitting never enlarges, so an image already inside the box is unchanged.
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

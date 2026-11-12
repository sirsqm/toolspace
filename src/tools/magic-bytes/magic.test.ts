import { describe, expect, it } from 'vitest'
import {
  byteOrderMark,
  classify,
  detect,
  detectOne,
  DUMP_LIMIT,
  entropy,
  formatBytes,
  formatDump,
  hexDump,
  looksLikeText,
  parseHex,
  parseText,
  preview,
  signatureFields,
  SIGNATURES,
  toHex,
} from './magic'

const png = parseHex('89504e470d0a1a0a0000000d49484452')
const gif = parseHex('47494638396101000100')

describe('parseHex', () => {
  it('reads plain hex pairs', () => {
    expect([...parseHex('8950 4e47')]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect([...parseHex('0x89,0x50')]).toEqual([0x89, 0x50])
  })

  it('returns nothing for empty input', () => {
    expect(parseHex('').length).toBe(0)
  })

  it('rejects bad input', () => {
    expect(() => parseHex('zz')).toThrow()
    expect(() => parseHex('abc')).toThrow(/even number/)
  })
})

describe('parseText', () => {
  it('encodes ASCII as one byte per character', () => {
    expect([...parseText('AB')]).toEqual([0x41, 0x42])
  })

  it('encodes non-ASCII as UTF-8', () => {
    expect([...parseText('é')]).toEqual([0xc3, 0xa9])
  })

  it('is empty for empty text', () => {
    expect(parseText('').length).toBe(0)
  })
})

describe('detect', () => {
  it('finds a PNG', () => {
    expect(detectOne(png)).toMatchObject({ name: 'PNG image', mime: 'image/png', extension: 'png' })
  })

  it('finds a GIF', () => {
    expect(detectOne(gif)?.extension).toBe('gif')
  })

  it('checks the container tail for RIFF formats', () => {
    const webp = parseHex('524946460000000057454250')
    const wav = parseHex('524946460000000057415645')
    expect(detectOne(webp)?.extension).toBe('webp')
    expect(detectOne(wav)?.extension).toBe('wav')
  })

  it('checks offset 4 for MP4', () => {
    const mp4 = parseHex('00000018667479706d703432')
    expect(detectOne(mp4)?.extension).toBe('mp4')
    expect(detectOne(mp4)?.offset).toBe(4)
  })

  it('checks offset 257 for TAR', () => {
    const header = new Uint8Array(262)
    header.set([0x75, 0x73, 0x74, 0x61, 0x72], 257)
    expect(detectOne(header)?.extension).toBe('tar')
  })

  it('requires every part of a multi-part signature', () => {
    const ts = new Uint8Array(189)
    ts[0] = 0x47
    expect(detectOne(ts)).toBeNull()
    ts[188] = 0x47
    expect(detectOne(ts)?.extension).toBe('ts')
    // Both pinned bytes count towards confidence.
    expect(detectOne(ts)?.confidence).toBe(2)
  })

  it('returns every match, most specific first', () => {
    const matches = detect(png)
    expect(matches.length).toBeGreaterThan(0)
    for (let i = 1; i < matches.length; i++) expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence)
  })

  it('returns nothing for an empty or unknown buffer', () => {
    expect(detect(new Uint8Array())).toEqual([])
    expect(detectOne(parseHex('0102030405'))).toBeNull()
  })

  it('recognises the newly added signatures', () => {
    expect(detectOne(parseHex('774f4632'))?.extension).toBe('woff2')
    expect(detectOne(parseHex('4d546864'))?.extension).toBe('mid')
    expect(detectOne(parseHex('00010000'))?.extension).toBe('ttf')
    expect(detectOne(parseHex('23212f62696e2f7368'))?.extension).toBe('sh')
    expect(detectOne(parseHex('38425053'))?.extension).toBe('psd')
  })
})

describe('looksLikeText and classify', () => {
  it('accepts ordinary text', () => {
    expect(looksLikeText(new TextEncoder().encode('hello world'))).toBe(true)
  })

  it('rejects a null byte', () => {
    expect(looksLikeText(new Uint8Array([0x68, 0x00, 0x69]))).toBe(false)
  })

  it('rejects a buffer full of control bytes', () => {
    expect(looksLikeText(new Uint8Array([0x01, 0x02, 0x03, 0x04]))).toBe(false)
  })

  it('rejects an empty buffer', () => {
    expect(looksLikeText(new Uint8Array())).toBe(false)
  })

  it('classifies empty, text and binary buffers', () => {
    expect(classify(new Uint8Array())).toBe('empty')
    expect(classify(parseText('hello'))).toBe('text')
    expect(classify(png)).toBe('binary')
  })
})

describe('byteOrderMark', () => {
  it('detects each mark', () => {
    expect(byteOrderMark(parseHex('efbbbf41'))).toBe('UTF-8')
    expect(byteOrderMark(parseHex('fffe4100'))).toBe('UTF-16 LE')
    expect(byteOrderMark(parseHex('feff0041'))).toBe('UTF-16 BE')
  })

  it('returns null without a mark', () => {
    expect(byteOrderMark(parseHex('41424344'))).toBeNull()
    expect(byteOrderMark(new Uint8Array())).toBeNull()
  })

  it('does not mistake a lone 0xff for a UTF-16 mark', () => {
    expect(byteOrderMark(new Uint8Array([0xff]))).toBeNull()
  })
})

describe('toHex and preview', () => {
  it('formats hex pairs', () => {
    expect(toHex(parseHex('89504e47'))).toBe('89 50 4e 47')
  })

  it('limits the length', () => {
    expect(toHex(png, 4)).toBe('89 50 4e 47')
  })

  it('shows printable characters and dots', () => {
    expect(preview(parseHex('41420043'))).toBe('AB.C')
  })
})

describe('hexDump and formatDump', () => {
  it('breaks bytes into 16-byte rows with offsets', () => {
    const bytes = new Uint8Array(20).map((_, index) => index)
    const lines = hexDump(bytes)
    expect(lines).toHaveLength(2)
    expect(lines[0].offset).toBe(0)
    expect(lines[1].offset).toBe(16)
    expect(lines[1].hex).toBe('10 11 12 13')
    expect(lines[0].ascii).toBe('................')
  })

  it('dots non-printable bytes in the ascii column', () => {
    const lines = hexDump(parseHex('41420043'))
    expect(lines[0].ascii).toBe('AB.C')
  })

  it('honours the limit', () => {
    const bytes = new Uint8Array(40)
    expect(hexDump(bytes, 16)).toHaveLength(1)
    expect(hexDump(bytes, DUMP_LIMIT)).toHaveLength(3)
  })

  it('formats a copyable dump with a padded offset column', () => {
    const text = formatDump(parseHex('41424344'))
    expect(text).toMatch(/^00000000 {2}41 42 43 44/)
    expect(text.endsWith('ABCD')).toBe(true)
  })

  it('is empty for an empty buffer', () => {
    expect(hexDump(new Uint8Array())).toEqual([])
    expect(formatDump(new Uint8Array())).toBe('')
  })
})

describe('entropy', () => {
  it('is zero for an empty or single-valued buffer', () => {
    expect(entropy(new Uint8Array())).toBe(0)
    expect(entropy(new Uint8Array([0x41, 0x41, 0x41, 0x41]))).toBe(0)
  })

  it('is one bit per byte for two equally likely values', () => {
    expect(entropy(new Uint8Array([0x00, 0xff]))).toBeCloseTo(1, 10)
  })

  it('approaches eight bits for a full byte range', () => {
    const all = new Uint8Array(256).map((_, index) => index)
    expect(entropy(all)).toBeCloseTo(8, 10)
  })

  it('scores structured bytes below random bytes', () => {
    const structured = new TextEncoder().encode('the quick brown fox '.repeat(8))
    const random = new Uint8Array(256).map((_, index) => (index * 137 + 43) % 256)
    expect(entropy(structured)).toBeLessThan(entropy(random))
  })

  it('only samples the first `limit` bytes', () => {
    const bytes = new Uint8Array(1024)
    for (let i = 0; i < 16; i++) bytes[i] = i
    expect(entropy(bytes, 16)).toBeCloseTo(4, 10)
    expect(entropy(bytes)).toBeLessThan(entropy(bytes, 16))
  })
})

describe('formatBytes', () => {
  it('shows small counts in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('scales to larger units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10240)).toBe('10 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })

  it('guards against nonsense input', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('signatureFields', () => {
  it('prints a pattern as hex pairs', () => {
    const pngSig = SIGNATURES.find((s) => s.name === 'PNG image')!
    expect(signatureFields(pngSig)).toEqual([{ offset: 0, pattern: '89 50 4e 47 0d 0a 1a 0a' }])
  })

  it('marks wildcard bytes', () => {
    const webp = SIGNATURES.find((s) => s.name === 'WebP image')!
    expect(signatureFields(webp)[0].pattern).toContain('??')
  })

  it('lists every part of a multi-part signature', () => {
    const ts = SIGNATURES.find((s) => s.name === 'MPEG transport stream')!
    const fields = signatureFields(ts)
    expect(fields.map((f) => f.offset)).toEqual([0, 188])
  })
})

describe('the signature table', () => {
  it('has unique names', () => {
    const names = SIGNATURES.map((signature) => signature.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every signature a mime type', () => {
    for (const signature of SIGNATURES) expect(signature.mime).toMatch(/\//)
  })

  it('has no wildcard-only pattern', () => {
    for (const signature of SIGNATURES) expect(signature.bytes.some((byte) => byte !== -1)).toBe(true)
  })

  it('never checks a byte past the dump limit', () => {
    for (const signature of SIGNATURES) {
      const furthest = signature.also
        ? Math.max(signature.at + signature.bytes.length, signature.also.at + signature.also.bytes.length)
        : signature.at + signature.bytes.length
      expect(furthest).toBeLessThanOrEqual(DUMP_LIMIT)
    }
  })
})

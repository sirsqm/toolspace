import { describe, expect, it } from 'vitest'
import { detectBot, looksLikeUserAgent, parseProducts, parseUserAgent, productVersion, SAMPLES, summarize } from './useragent'

const sample = (label: string) => SAMPLES.find((entry) => entry.label === label)!.ua

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

describe('parseProducts', () => {
  it('lists products in order with versions', () => {
    expect(parseProducts('Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36')).toEqual([
      { name: 'Mozilla', version: '5.0' },
      { name: 'Chrome', version: '124.0.0.0' },
      { name: 'Safari', version: '537.36' },
    ])
  })

  it('returns an empty list when nothing matches', () => {
    expect(parseProducts('hello world')).toEqual([])
  })
})

describe('productVersion', () => {
  const products = parseProducts('AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15')
  it('finds the first named product', () => {
    expect(productVersion(products, 'Version')).toBe('17.4')
  })
  it('falls through names in priority order', () => {
    expect(productVersion(products, 'FxiOS', 'Safari')).toBe('605.1.15')
  })
  it('returns empty when absent', () => {
    expect(productVersion(products, 'Chrome')).toBe('')
  })
})

describe('looksLikeUserAgent', () => {
  it('accepts a Mozilla string', () => expect(looksLikeUserAgent(CHROME_WIN)).toBe(true))
  it('accepts a bare client token', () => expect(looksLikeUserAgent('curl/8.4.0')).toBe(true))
  it('rejects empty and prose', () => {
    expect(looksLikeUserAgent('')).toBe(false)
    expect(looksLikeUserAgent('   ')).toBe(false)
    expect(looksLikeUserAgent('this is not a user agent')).toBe(false)
  })
})

describe('parseUserAgent — browsers', () => {
  it('detects Chrome on Windows', () => {
    const info = parseUserAgent(sample('Chrome on Windows'))
    expect(info.browser).toBe('Chrome')
    expect(info.browserVersion).toBe('124.0.0.0')
    expect(info.engine).toBe('Blink')
    expect(info.os).toBe('Windows')
    expect(info.osVersion).toBe('10/11')
    expect(info.device).toBe('desktop')
    expect(info.kind).toBe('browser')
  })

  it('detects Safari on iPhone with a dotted OS version', () => {
    const info = parseUserAgent(sample('Safari on iPhone'))
    expect(info.browser).toBe('Safari')
    expect(info.browserVersion).toBe('17.4')
    expect(info.os).toBe('iOS')
    expect(info.osVersion).toBe('17.4')
    expect(info.engine).toBe('WebKit')
    expect(info.device).toBe('mobile')
    expect(info.deviceModel).toBe('iPhone')
  })

  it('detects Firefox on Linux with the Gecko engine', () => {
    const info = parseUserAgent(sample('Firefox on Linux'))
    expect(info.browser).toBe('Firefox')
    expect(info.browserVersion).toBe('125.0')
    expect(info.engine).toBe('Gecko')
    expect(info.engineVersion).toBe('125.0')
    expect(info.os).toBe('Linux')
    expect(info.cpu).toBe('x64')
  })

  it('prefers Edge over the Chrome it impersonates', () => {
    const info = parseUserAgent(sample('Edge on Windows'))
    expect(info.browser).toBe('Edge')
    expect(info.browserVersion).toBe('124.0.2478.67')
    expect(info.engine).toBe('Blink')
  })

  it('detects Safari on macOS and collapses the 10_15 patch', () => {
    const info = parseUserAgent(sample('Safari on macOS'))
    expect(info.browser).toBe('Safari')
    expect(info.os).toBe('macOS')
    expect(info.osVersion).toBe('10.15')
  })

  it('detects Chromium-based browsers that claim Chrome', () => {
    expect(parseUserAgent('Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0').browser).toBe('Opera')
    expect(parseUserAgent('Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 SamsungBrowser/23.0').browser).toBe('Samsung Internet')
    expect(parseUserAgent('Mozilla/5.0 AppleWebKit/537.36 Vivaldi/6.6.3271.53 Chrome/120.0.0.0').browser).toBe('Vivaldi')
  })

  it('detects legacy Edge and Internet Explorer', () => {
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/64.0 Safari/537.36 Edge/18.19041').browser).toBe('Edge')
    const ie = parseUserAgent('Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko')
    expect(ie.browser).toBe('Internet Explorer')
    expect(ie.browserVersion).toBe('11.0')
    expect(ie.engine).toBe('Trident')
    expect(ie.osVersion).toBe('7')
  })

  it('falls back to the Trident revision when IE omits rv:', () => {
    const info = parseUserAgent('Mozilla/5.0 (Windows NT 6.1; Trident/7.0) like Gecko')
    expect(info.browser).toBe('Internet Explorer')
    expect(info.browserVersion).toBe('11.0')
  })
})

describe('parseUserAgent — bots and clients', () => {
  it('detects Googlebot', () => {
    const info = parseUserAgent(sample('Googlebot'))
    expect(info.bot).toBe(true)
    expect(info.botName).toBe('Googlebot')
    expect(info.device).toBe('bot')
    expect(info.kind).toBe('bot')
  })

  it('names specific crawlers', () => {
    expect(detectBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe('Bingbot')
    expect(detectBot('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0')).toBe('GPTBot')
    expect(detectBot('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBe('AhrefsBot')
  })

  it('falls back to a generic crawler label', () => {
    expect(detectBot('SomeUnknownSpider/1.0')).toBe('Crawler')
  })

  it('detects a command-line client as a cli device', () => {
    const info = parseUserAgent(sample('curl'))
    expect(info.browser).toBe('curl')
    expect(info.device).toBe('cli')
    expect(info.kind).toBe('cli')
    expect(info.bot).toBe(false)
  })

  it('detects common library clients', () => {
    expect(parseUserAgent('python-requests/2.31.0').browser).toBe('Python client')
    expect(parseUserAgent('Go-http-client/1.1').kind).toBe('cli')
    expect(parseUserAgent('okhttp/4.12.0').browser).toBe('OkHttp')
  })
})

describe('parseUserAgent — devices', () => {
  it('detects an Android tablet and its model', () => {
    const info = parseUserAgent(sample('Android tablet'))
    expect(info.device).toBe('tablet')
    expect(info.os).toBe('Android')
    expect(info.osVersion).toBe('14')
    expect(info.deviceModel).toBe('SM-X710')
    expect(info.isMobile).toBe(true)
  })

  it('detects an Android phone', () => {
    const info = parseUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 Chrome/115.0 Mobile Safari/537.36')
    expect(info.device).toBe('mobile')
    expect(info.deviceModel).toBe('Pixel 7')
  })

  it('ignores the reduced-UA "K" placeholder as a model', () => {
    const info = parseUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36')
    expect(info.device).toBe('mobile')
    expect(info.deviceModel).toBe('')
    expect(info.browser).toBe('Chrome')
  })
})

describe('parseUserAgent — edge cases', () => {
  it('handles empty input as unknown', () => {
    const info = parseUserAgent('')
    expect(info.device).toBe('unknown')
    expect(info.kind).toBe('unknown')
    expect(info.bot).toBe(false)
    expect(info.browser).toBe('Unknown')
  })

  it('handles whitespace-only input like empty', () => {
    expect(parseUserAgent('   \n  ').kind).toBe('unknown')
  })

  it('marks an unrecognised-but-UA-shaped string without crashing', () => {
    const info = parseUserAgent('SomeApp/1.0 (compatible)')
    expect(info.kind).toBe('app')
    expect(info.os).toBe('Unknown')
    expect(info.device).toBe('unknown')
  })

  it('is not confused by a huge input', () => {
    const info = parseUserAgent(CHROME_WIN + ' '.repeat(200_000))
    expect(info.browser).toBe('Chrome')
  })
})

describe('summarize', () => {
  it('reads as one sentence for a browser', () => {
    const text = summarize(parseUserAgent(CHROME_WIN))
    expect(text).toContain('Chrome 124.0.0.0')
    expect(text).toContain('Windows 10/11')
    expect(text).toContain('Blink')
  })

  it('names the crawler for a bot', () => {
    expect(summarize(parseUserAgent(sample('Googlebot')))).toContain('Googlebot')
  })

  it('explains an unreadable string', () => {
    expect(summarize(parseUserAgent('nonsense'))).toMatch(/Could not read/)
  })
})

describe('SAMPLES', () => {
  it('every sample parses to something other than unknown', () => {
    for (const entry of SAMPLES) {
      const info = parseUserAgent(entry.ua)
      expect(info.kind, entry.label).not.toBe('unknown')
      expect(looksLikeUserAgent(entry.ua), entry.label).toBe(true)
    }
  })
})

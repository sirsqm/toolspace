/**
 * User-agent string parsing.
 *
 * A UA string is a pile of `Token/version` products and comment blocks, and
 * the products lie about each other: Edge claims to be Chrome, Chrome claims
 * to be Safari, and every WebKit browser claims to be "like Gecko". So the
 * parser is a small ordered rule table — most specific first — rather than a
 * bag of independent regex tests, and the ordering is the whole correctness
 * story. Every rule is pure so the whole table is testable.
 */

export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'cli' | 'unknown'
export type AgentKind = 'browser' | 'bot' | 'cli' | 'app' | 'unknown'

export interface UserAgentInfo {
  browser: string
  browserVersion: string
  /** Rendering engine, e.g. Blink, WebKit, Gecko, Trident. */
  engine: string
  engineVersion: string
  os: string
  osVersion: string
  device: DeviceKind
  /** Hardware model when the string names one, e.g. "iPhone" or "Pixel 7". */
  deviceModel: string
  /** CPU architecture hint, e.g. x64, arm64. */
  cpu: string
  bot: boolean
  /** Name of the crawler when it is a known one, else "". */
  botName: string
  kind: AgentKind
  isMobile: boolean
}

/** A `Token/version` product, in the order it appears in the string. */
export interface Product {
  name: string
  version: string
}

const EMPTY: UserAgentInfo = {
  browser: 'Unknown',
  browserVersion: '',
  engine: 'Unknown',
  engineVersion: '',
  os: 'Unknown',
  osVersion: '',
  device: 'unknown',
  deviceModel: '',
  cpu: '',
  bot: false,
  botName: '',
  kind: 'unknown',
  isMobile: false,
}

/** Split a UA string into its `Token/version` products, in order. */
export function parseProducts(input: string): Product[] {
  const products: Product[] = []
  const pattern = /([A-Za-z][A-Za-z0-9._-]*)\/([A-Za-z0-9._-]*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) {
    products.push({ name: match[1], version: match[2] })
  }
  return products
}

/** The version of the first product with the given name, else "". */
export function productVersion(products: Product[], ...names: string[]): string {
  for (const name of names) {
    const found = products.find((product) => product.name.toLowerCase() === name.toLowerCase())
    if (found) return found.version.replace(/_/g, '.')
  }
  return ''
}

/**
 * Pull a version out of prose such as `Windows NT 10.0` or `OS 17_4`, which is
 * not a `Token/version` product. Underscores are normalised to dots because
 * Apple writes iOS versions as `17_4`.
 */
export function matchVersion(input: string, pattern: RegExp): string {
  const match = pattern.exec(input)
  return match?.[1]?.replace(/_/g, '.') ?? ''
}

/**
 * Does this look like a user-agent string at all? Used to give an honest
 * "that is not a user agent" state instead of a confident wall of "Unknown".
 * A bare product token such as `curl/8.0` counts; prose does not.
 */
export function looksLikeUserAgent(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (/mozilla|opera|webkit|gecko|trident|curl|wget|httpie|okhttp|postman|python|java|go-http/i.test(value)) return true
  return /\b[A-Za-z][A-Za-z0-9._-]*\/\d/.test(value)
}

/* -------------------------------------------------------------------------
   Bots and non-browser clients
   ------------------------------------------------------------------------- */

/** Known crawlers and preview fetchers, matched case-insensitively in order. */
const BOTS: [RegExp, string][] = [
  [/googlebot-image/i, 'Googlebot Image'],
  [/googlebot-news/i, 'Googlebot News'],
  [/googlebot-video/i, 'Googlebot Video'],
  [/googlebot/i, 'Googlebot'],
  [/google-inspectiontool|storebot-google/i, 'Google Inspection Tool'],
  [/adsbot-google/i, 'AdsBot Google'],
  [/apis-google/i, 'APIs-Google'],
  [/mediapartners-google/i, 'AdSense'],
  [/bingpreview/i, 'Bing Preview'],
  [/bingbot|adidxbot/i, 'Bingbot'],
  [/duckduckbot/i, 'DuckDuckBot'],
  [/yandex(bot|images|mobilebot)/i, 'YandexBot'],
  [/baiduspider/i, 'Baiduspider'],
  [/slurp/i, 'Yahoo Slurp'],
  [/facebookexternalhit|facebookcatalog/i, 'Facebook'],
  [/twitterbot/i, 'Twitterbot'],
  [/linkedinbot/i, 'LinkedInBot'],
  [/applebot/i, 'Applebot'],
  [/ahrefsbot/i, 'AhrefsBot'],
  [/semrushbot/i, 'SemrushBot'],
  [/petalbot/i, 'PetalBot'],
  [/mj12bot/i, 'MJ12bot'],
  [/dotbot/i, 'DotBot'],
  [/gptbot/i, 'GPTBot'],
  [/chatgpt-user/i, 'ChatGPT-User'],
  [/claudebot|claude-web/i, 'ClaudeBot'],
  [/perplexitybot/i, 'PerplexityBot'],
  [/ccbot/i, 'CCBot'],
  [/ia_archiver/i, 'Alexa'],
  [/uptimerobot/i, 'UptimeRobot'],
  [/pingdom/i, 'Pingdom'],
  [/headlesschrome/i, 'Headless Chrome'],
  [/phantomjs/i, 'PhantomJS'],
  [/bot|crawler|spider|crawling|slurp/i, 'Crawler'],
]

/** Command-line and HTTP clients that send a UA but are not browsers. */
const CLIENTS: [RegExp, string][] = [
  [/curl\//i, 'curl'],
  [/wget\//i, 'Wget'],
  [/httpie\//i, 'HTTPie'],
  [/postmanruntime/i, 'Postman'],
  [/insomnia/i, 'Insomnia'],
  [/python-requests|python-urllib|aiohttp|httpx/i, 'Python client'],
  [/go-http-client/i, 'Go client'],
  [/okhttp/i, 'OkHttp'],
  [/node-fetch|axios|undici/i, 'Node client'],
  [/java\/|apache-httpclient/i, 'Java client'],
  [/libwww-perl/i, 'Perl client'],
  [/rest-client/i, 'Ruby client'],
  [/php\//i, 'PHP client'],
]

export function detectBot(input: string): string {
  for (const [pattern, name] of BOTS) if (pattern.test(input)) return name
  return ''
}

function detectClient(input: string): string {
  for (const [pattern, name] of CLIENTS) if (pattern.test(input)) return name
  return ''
}

/* -------------------------------------------------------------------------
   Browsers — ordered, most specific first
   ------------------------------------------------------------------------- */

interface BrowserRule {
  /** Matched anywhere in the string. */
  test: RegExp
  name: string
  /** Product names whose version is the browser version, in priority order. */
  version: string[]
}

const BROWSERS: BrowserRule[] = [
  { test: /EdgiOS\//i, name: 'Edge', version: ['EdgiOS'] },
  { test: /EdgA?\//i, name: 'Edge', version: ['EdgA', 'Edg'] },
  { test: /Edge\//i, name: 'Edge', version: ['Edge'] },
  { test: /OPiOS\//i, name: 'Opera', version: ['OPiOS'] },
  { test: /OPR\//i, name: 'Opera', version: ['OPR'] },
  { test: /Opera Mini/i, name: 'Opera Mini', version: ['Opera Mini', 'Opera'] },
  { test: /Opera Mobi/i, name: 'Opera Mobile', version: ['Opera Mobi', 'Opera'] },
  { test: /Opera[\/ ]/i, name: 'Opera', version: ['Opera', 'Version'] },
  { test: /SamsungBrowser\//i, name: 'Samsung Internet', version: ['SamsungBrowser'] },
  { test: /Vivaldi\//i, name: 'Vivaldi', version: ['Vivaldi'] },
  { test: /Brave\//i, name: 'Brave', version: ['Brave'] },
  { test: /YaBrowser\//i, name: 'Yandex Browser', version: ['YaBrowser'] },
  { test: /UCBrowser\//i, name: 'UC Browser', version: ['UCBrowser'] },
  { test: /DuckDuckGo\//i, name: 'DuckDuckGo', version: ['DuckDuckGo'] },
  { test: /FxiOS\//i, name: 'Firefox', version: ['FxiOS'] },
  { test: /Firefox\//i, name: 'Firefox', version: ['Firefox'] },
  { test: /MSIE\s/i, name: 'Internet Explorer', version: ['MSIE'] },
  { test: /Trident\//i, name: 'Internet Explorer', version: ['rv'] },
  { test: /CriOS\//i, name: 'Chrome', version: ['CriOS'] },
  { test: /HeadlessChrome\//i, name: 'Headless Chrome', version: ['HeadlessChrome'] },
  { test: /Chromium\//i, name: 'Chromium', version: ['Chromium'] },
  { test: /Chrome\//i, name: 'Chrome', version: ['Chrome'] },
  { test: /Safari\//i, name: 'Safari', version: ['Version'] },
]

/** Trident revision to the IE version it shipped with, for strings with no `rv:`. */
const TRIDENT_IE: Record<string, string> = {
  '7.0': '11.0',
  '6.0': '10.0',
  '5.0': '9.0',
  '4.0': '8.0',
}

function detectBrowser(ua: string, products: Product[]): { browser: string; version: string } {
  for (const rule of BROWSERS) {
    if (rule.test.test(ua)) {
      const version = productVersion(products, ...rule.version)
      // Trident-era IE writes its version as `rv:11.0` (a colon, not a slash),
      // so it is not picked up as a product. Some builds omit it entirely, in
      // which case the Trident revision still pins the IE version.
      if (!version && rule.name === 'Internet Explorer') {
        const rv = matchVersion(ua, /\brv:([\d.]+)/)
        return { browser: rule.name, version: rv || TRIDENT_IE[productVersion(products, 'Trident')] || '' }
      }
      return { browser: rule.name, version }
    }
  }
  return { browser: 'Unknown', version: '' }
}

/* -------------------------------------------------------------------------
   Engines
   ------------------------------------------------------------------------- */

function detectEngine(ua: string, products: Product[]): { engine: string; version: string } {
  if (/Trident\//i.test(ua) || /MSIE\s/i.test(ua)) {
    const version =
      productVersion(products, 'Trident') || productVersion(products, 'MSIE') || matchVersion(ua, /\brv:([\d.]+)/)
    return { engine: 'Trident', version }
  }
  if (/Presto\//i.test(ua)) {
    return { engine: 'Presto', version: productVersion(products, 'Presto') }
  }
  if (/AppleWebKit/i.test(ua)) {
    // Every Chromium browser ships "AppleWebKit ... like Gecko" too, so the
    // engine is decided by the *other* product in the string.
    const chromium = /(Chrome|Chromium|CriOS|HeadlessChrome|Edg|EdgA|EdgiOS|OPR|Opera|SamsungBrowser|YaBrowser|Vivaldi|Brave)\//i.test(ua)
    if (chromium) {
      const version = productVersion(products, 'Chrome', 'Chromium', 'CriOS', 'HeadlessChrome')
      return { engine: 'Blink', version }
    }
    return { engine: 'WebKit', version: productVersion(products, 'AppleWebKit') }
  }
  if (/Gecko\/|Firefox|FxiOS/i.test(ua)) {
    const version = productVersion(products, 'rv') || productVersion(products, 'Firefox', 'FxiOS')
    return { engine: 'Gecko', version }
  }
  if (/KHTML/i.test(ua)) return { engine: 'KHTML', version: '' }
  return { engine: 'Unknown', version: '' }
}

/* -------------------------------------------------------------------------
   Operating systems
   ------------------------------------------------------------------------- */

const WINDOWS_NT: Record<string, string> = {
  '10.0': '10/11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.1': 'XP',
}

function detectOs(ua: string): { os: string; version: string } {
  if (/Windows Phone/i.test(ua)) return { os: 'Windows Phone', version: matchVersion(ua, /Windows Phone OS ([\d.]+)/) }
  if (/Windows NT/i.test(ua)) {
    const nt = matchVersion(ua, /Windows NT ([\d.]+)/)
    return { os: 'Windows', version: WINDOWS_NT[nt] ?? nt }
  }
  if (/Android/i.test(ua)) return { os: 'Android', version: matchVersion(ua, /Android[ /]([\d.]+)/) }
  if (/(?:iPhone|iPad|iPod)/i.test(ua)) return { os: 'iOS', version: matchVersion(ua, /OS ([\d_.]+)/) }
  if (/KaiOS/i.test(ua)) return { os: 'KaiOS', version: matchVersion(ua, /KaiOS\/([\d.]+)/) }
  if (/CrOS/i.test(ua)) return { os: 'ChromeOS', version: matchVersion(ua, /CrOS [A-Za-z0-9_]+ ([\d.]+)/) }
  if (/Tizen/i.test(ua)) return { os: 'Tizen', version: matchVersion(ua, /Tizen[ /]([\d.]+)/) }
  if (/webOS|web0s/i.test(ua)) return { os: 'webOS', version: matchVersion(ua, /web[O0][Ss]\/([\d.]+)/i) }
  if (/HarmonyOS/i.test(ua)) return { os: 'HarmonyOS', version: matchVersion(ua, /HarmonyOS[ /]([\d.]+)/i) }
  if (/Mac OS X|Macintosh/i.test(ua)) {
    const raw = matchVersion(ua, /Mac OS X ([\d_.]+)/)
    // macOS reports 10_15_7 up to Big Sur, then jumps to 11, 12, 13...
    const parts = raw.split('.')
    const version = parts[0] === '10' && parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0] ?? ''
    return { os: 'macOS', version }
  }
  if (/Ubuntu/i.test(ua)) return { os: 'Ubuntu', version: '' }
  if (/Fedora/i.test(ua)) return { os: 'Fedora', version: '' }
  if (/FreeBSD/i.test(ua)) return { os: 'FreeBSD', version: '' }
  if (/OpenBSD/i.test(ua)) return { os: 'OpenBSD', version: '' }
  if (/NetBSD/i.test(ua)) return { os: 'NetBSD', version: '' }
  if (/Linux|X11/i.test(ua)) return { os: 'Linux', version: '' }
  return { os: 'Unknown', version: '' }
}

/* -------------------------------------------------------------------------
   Device and CPU
   ------------------------------------------------------------------------- */

function detectDeviceModel(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/iPod/i.test(ua)) return 'iPod'
  const android = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build[/)]|\))/i.exec(ua)
  if (android) {
    const model = android[1].trim().replace(/\s+/g, ' ')
    // Chrome's reduced UA sends a single "K" as the model from Android 10 on,
    // which is a privacy placeholder rather than a device name.
    if (model && !/^(wv|mobile|tablet|k)$/i.test(model)) return model
  }
  const samsung = /\b(SM-[A-Z0-9]+)\b/i.exec(ua)
  if (samsung) return samsung[1].toUpperCase()
  const pixel = /\b(Pixel(?: [0-9A-Za-z]+)?)\b/i.exec(ua)
  if (pixel) return pixel[1]
  if (/Kindle/i.test(ua)) return 'Kindle'
  if (/Silk\//i.test(ua)) return 'Kindle Fire'
  if (/PlayBook/i.test(ua)) return 'PlayBook'
  if (/Xbox/i.test(ua)) return 'Xbox'
  if (/PlayStation/i.test(ua)) return 'PlayStation'
  return ''
}

function detectCpu(ua: string): string {
  if (/arm64|aarch64/i.test(ua)) return 'arm64'
  if (/\b(?:WOW64|Win64|x64|x86_64)\b/i.test(ua)) return 'x64'
  if (/\b(?:i[3-6]86|i86pc)\b/i.test(ua)) return 'x86'
  if (/\b(?:armv?\d|arm)\b/i.test(ua)) return 'ARM'
  if (/PPC|PowerPC/i.test(ua)) return 'PowerPC'
  return ''
}

/* -------------------------------------------------------------------------
   Entry point
   ------------------------------------------------------------------------- */

export function parseUserAgent(input: string): UserAgentInfo {
  const ua = input.trim()
  if (!ua) return { ...EMPTY }

  const products = parseProducts(ua)
  const botName = detectBot(ua)
  const clientName = detectClient(ua)
  const { browser, version } = detectBrowser(ua, products)
  const { engine, version: engineVersion } = detectEngine(ua, products)
  const { os, version: osVersion } = detectOs(ua)
  const deviceModel = detectDeviceModel(ua)
  const cpu = detectCpu(ua)

  const isBot = botName !== ''
  const isClient = !isBot && browser === 'Unknown' && clientName !== ''

  let device: DeviceKind = 'desktop'
  if (isBot) device = 'bot'
  else if (isClient) device = 'cli'
  else if (/iPad|Tablet|PlayBook|Kindle|Silk\/|Nexus 7|Nexus 10|\bSM-[TPX]\d/i.test(ua)) device = 'tablet'
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) device = 'mobile'
  else if (os === 'Unknown') device = 'unknown'

  const kind: AgentKind = isBot
    ? 'bot'
    : isClient
      ? 'cli'
      : browser !== 'Unknown'
        ? 'browser'
        : products.length
          ? 'app'
          : 'unknown'

  const isMobile = device === 'mobile' || device === 'tablet'

  return {
    browser: isBot ? botName || 'Bot' : isClient ? clientName : browser,
    browserVersion: version,
    engine,
    engineVersion,
    os,
    osVersion,
    device,
    deviceModel,
    cpu,
    bot: isBot,
    botName,
    kind,
    isMobile,
  }
}

/** One plain sentence describing the parse, for a summary line. */
export function summarize(info: UserAgentInfo): string {
  if (info.kind === 'unknown') return 'Could not read this as a user-agent string.'
  if (info.kind === 'app') return `Unrecognised client${info.os !== 'Unknown' ? ` on ${info.os}` : ''} — not a known browser.`
  const parts: string[] = []
  if (info.bot) parts.push(info.botName || 'A crawler')
  else parts.push(info.browserVersion ? `${info.browser} ${info.browserVersion}` : info.browser)
  if (info.os !== 'Unknown') parts.push(`on ${info.os}${info.osVersion ? ` ${info.osVersion}` : ''}`)
  const where = info.deviceModel ? `${info.deviceModel} (${info.device})` : info.device
  parts.push(`— ${where}`)
  if (info.engine !== 'Unknown') parts.push(`via ${info.engine}`)
  return parts.join(' ')
}

/** The samples the tool offers, so it is useful with no UA to hand. */
export const SAMPLES: { label: string; ua: string }[] = [
  {
    label: 'Chrome on Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    label: 'Safari on iPhone',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  },
  {
    label: 'Firefox on Linux',
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  },
  {
    label: 'Edge on Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.67',
  },
  {
    label: 'Android tablet',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  {
    label: 'Googlebot',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  },
  {
    label: 'curl',
    ua: 'curl/8.4.0',
  },
  {
    label: 'Safari on macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  },
]

/**
 * Pure helpers used when a page view arrives: what kind of device and browser sent it, whether it is a
 * bot, and which channel (search, social, email, …) brought the visitor. No personal data is kept:
 * only these categories are stored, never the user-agent string or the IP address.
 */

export type DeviceType = 'desktop' | 'mobile' | 'tablet';
export type Channel = 'direct' | 'organic' | 'social' | 'referral' | 'email' | 'paid' | 'other';
export type ScreenSize = 'small' | 'medium' | 'large' | 'xlarge';

export const CHANNELS: readonly Channel[] = ['direct', 'organic', 'social', 'referral', 'email', 'paid', 'other'];

const BOT =
  /bot\b|bot[/;_-]|crawl|spider|slurp|scrape|fetch|curl|wget|python|java\/|go-http|okhttp|axios|node-fetch|httpclient|libwww|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|embedly|whatsapp\/|telegrambot|discordbot|bingpreview|yahoo! slurp|duckduckbot|baiduspider|yandex|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|applebot/i;

/** True for crawlers, link previews, monitoring tools and scripts. */
export function isBot(userAgent: string): boolean {
  return !userAgent || userAgent.length < 20 || BOT.test(userAgent);
}

export interface Agent {
  device: DeviceType;
  browser: string;
  os: string;
}

/** A deliberately small user-agent reader: browser family, OS family and device type. */
export function parseUserAgent(ua: string): Agent {
  const tablet = /iPad|Tablet|PlayBook|Silk|Kindle|(Android(?!.*Mobile))/i.test(ua);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android|Windows Phone|Opera Mini|IEMobile/i.test(ua);

  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /UCBrowser\//.test(ua) ? 'UC Browser'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /MSIE |Trident\//.test(ua) ? 'Internet Explorer'
    : 'Other';

  const os =
    /Windows/.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Other';

  return { device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', browser, os };
}

/** Screen width in CSS pixels → a coarse category (never the exact size). */
export function screenCategory(width: unknown): ScreenSize | null {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return null;
  return w < 576 ? 'small' : w < 992 ? 'medium' : w < 1440 ? 'large' : 'xlarge';
}

const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|baidu|yandex|ecosia|ask|aol|brave|startpage|qwant|naver|sogou)\.[a-z.]+$/;
const SOCIAL =
  /(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|tiktok\.com|pinterest\.[a-z.]+|reddit\.com|whatsapp\.com|wa\.me|telegram\.org|t\.me|snapchat\.com|threads\.net|quora\.com)$/;

export interface Utm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

/** Host of a referrer URL, without "www.", or null. */
export function referrerHost(referrer: unknown): string | null {
  if (typeof referrer !== 'string' || !referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '').slice(0, 120) || null;
  } catch {
    return null;
  }
}

/**
 * Which channel brought the visitor. UTM tags win (they are set on purpose by whoever shared the link);
 * otherwise the referring site decides. A referrer on the site's own host counts as direct.
 */
export function channelFor(host: string | null, utm: Utm, ownHosts: readonly string[] = []): Channel {
  const medium = (utm.medium ?? '').toLowerCase();
  const source = (utm.source ?? '').toLowerCase();
  if (/^(cpc|ppc|paid|paidsearch|paid_search|paid-social|paid_social|cpm|display|ads?|banner)$/.test(medium)) return 'paid';
  if (/^(e-?mail|newsletter)$/.test(medium) || /^(e-?mail|newsletter)$/.test(source)) return 'email';
  if (/^(social|social-network|social_media|sm)$/.test(medium)) return 'social';
  if (/^(organic|seo)$/.test(medium)) return 'organic';
  if (/^(sms|whatsapp)$/.test(medium)) return 'other';

  if (host && !ownHosts.includes(host)) {
    if (SEARCH.test(host)) return 'organic';
    if (SOCIAL.test(host)) return 'social';
    return 'referral';
  }
  if (source) return SEARCH.test(`${source}.com`) ? 'organic' : SOCIAL.test(`${source}.com`) ? 'social' : 'referral';
  return 'direct';
}

/** Path only: no query string (it can hold tokens or e-mail addresses), no fragment, no trailing slash. */
export function normalisePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  let path = value.split(/[?#]/)[0];
  try {
    path = decodeURI(path);
  } catch {
    /* keep it encoded */
  }
  if (path.length > 1) path = path.replace(/\/+$/, '');
  // Personal links (password reset, previews, staff sign-in) must not end up in reports.
  path = path
    .replace(/^\/(preview)\/[^/]+/, '/$1/…')
    .replace(/^\/admin\/[A-Za-z0-9_-]{20,}$/, '/admin/…');
  return path.slice(0, 300) || '/';
}

/** A short, trimmed text value, or null. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

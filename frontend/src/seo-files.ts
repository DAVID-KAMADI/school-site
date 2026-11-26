/**
 * /robots.txt and /sitemap.xml for search engines, served by the website server (server.ts).
 * The list of addresses comes from the API (GET /api/v1/public/sitemap).
 */

export interface SitemapEntry {
  path: string;
  lastModified: string | null;
  alternates?: { locale: string; path: string }[];
}

/** Areas search engines should not crawl: the staff portal, applicant accounts, previews and the API. */
export const ROBOTS_DISALLOW = ['/admin', '/apply/application', '/apply/reset-password', '/preview/', '/api/'];

/** The site's public address without a trailing slash, e.g. "https://www.rcti.ac.ke". */
export function siteBaseUrl(configured: string | undefined, protocol: string, host: string | undefined): string {
  const base = configured?.trim() || `${protocol}://${host ?? 'localhost'}`;
  return base.replace(/\/+$/, '');
}

export function robotsTxt(baseUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Encodes each path segment (spaces, accents) but keeps the slashes. */
const absolute = (baseUrl: string, path: string) =>
  baseUrl + (path.split('/').map((s) => encodeURIComponent(decodeURIComponentSafe(s))).join('/') || '/');

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function sitemapXml(baseUrl: string, entries: SitemapEntry[]): string {
  const hasAlternates = entries.some((e) => e.alternates?.length);
  const urls = entries.map((entry) => {
    const lines = [`    <loc>${escapeXml(absolute(baseUrl, entry.path))}</loc>`];
    if (entry.lastModified) lines.push(`    <lastmod>${escapeXml(entry.lastModified.slice(0, 10))}</lastmod>`);
    for (const alt of entry.alternates ?? [])
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(alt.locale)}" href="${escapeXml(absolute(baseUrl, alt.path))}"/>`,
      );
    return `  <url>\n${lines.join('\n')}\n  </url>`;
  });
  const namespaces = `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${
    hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''
  }`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>\n${urls.join('\n')}\n</urlset>\n`;
}

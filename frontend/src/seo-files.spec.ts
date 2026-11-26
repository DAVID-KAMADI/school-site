import { robotsTxt, siteBaseUrl, sitemapXml } from './seo-files';

describe('seo files', () => {
  it('uses SITE_URL when set, otherwise the request address', () => {
    expect(siteBaseUrl('https://www.example.ac.ke/', 'http', 'localhost:8081')).toBe('https://www.example.ac.ke');
    expect(siteBaseUrl(undefined, 'http', 'localhost:8081')).toBe('http://localhost:8081');
  });

  it('keeps staff and applicant areas out of search engines and points to the sitemap', () => {
    const robots = robotsTxt('https://www.example.ac.ke');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /apply/application');
    expect(robots).not.toContain('Disallow: /\n');
    expect(robots).toContain('Sitemap: https://www.example.ac.ke/sitemap.xml');
  });

  it('lists addresses with dates and language versions', () => {
    const xml = sitemapXml('https://www.example.ac.ke', [
      { path: '/', lastModified: '2026-11-20T08:00:00.000Z' },
      {
        path: '/about us & history',
        lastModified: null,
        alternates: [
          { locale: 'en', path: '/about us & history' },
          { locale: 'fr', path: '/fr/about us & history' },
        ],
      },
    ]);
    expect(xml).toContain('<loc>https://www.example.ac.ke/</loc>');
    expect(xml).toContain('<lastmod>2026-11-20</lastmod>');
    expect(xml).toContain('<loc>https://www.example.ac.ke/about%20us%20%26%20history</loc>');
    expect(xml).toContain('hreflang="fr" href="https://www.example.ac.ke/fr/about%20us%20%26%20history"');
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  });
});

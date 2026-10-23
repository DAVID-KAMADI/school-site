import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { REQUEST } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SiteStore } from './site';

const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'sw', name: 'Kiswahili', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
];

/** Answers the site-data request for a locale, as the API would. */
function answerSite(http: HttpTestingController, locale: string) {
  const req = http.expectOne((r) => r.url === '/api/v1/public/site' && r.params.get('locale') === locale);
  req.flush({ locale, languages: LANGUAGES, settings: {}, media: {}, text: {}, menus: {} });
}

/** Lets pending promise callbacks run, so the next HTTP request has been sent. */
const tick = () => new Promise((r) => setTimeout(r));

function setBrowserLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
}

function clearCookie() {
  document.cookie = 'site_lang=; path=/; max-age=0';
}

const savedLanguage = () => /(?:^|;\s*)site_lang=([a-z]{2})/.exec(document.cookie)?.[1] ?? null;

describe('SiteStore language detection (in the browser)', () => {
  let site: SiteStore;
  let http: HttpTestingController;

  beforeEach(() => {
    clearCookie();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    site = TestBed.inject(SiteStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    clearCookie();
  });

  it('sends a German browser to the German page and remembers it', async () => {
    setBrowserLanguages(['de-DE', 'de', 'en']);
    const result = site.detect('/admissions?tab=2');
    await tick();
    answerSite(http, 'en');
    expect(await result).toBe('/de/admissions?tab=2');
    expect(savedLanguage()).toBe('de');
  });

  it('picks the first browser language the site offers', async () => {
    setBrowserLanguages(['fr-FR', 'fr', 'sw-KE']);
    const result = site.detect('/');
    await tick();
    answerSite(http, 'en');
    expect(await result).toBe('/sw');
  });

  it('leaves English browsers on the page', async () => {
    setBrowserLanguages(['en-US', 'en']);
    const result = site.detect('/about');
    await tick();
    answerSite(http, 'en');
    expect(await result).toBeNull();
    expect(savedLanguage()).toBeNull();
  });

  it('leaves browsers in languages the site does not offer on the page', async () => {
    setBrowserLanguages(['fr-FR', 'it']);
    const result = site.detect('/about');
    await tick();
    answerSite(http, 'en');
    expect(await result).toBeNull();
    expect(savedLanguage()).toBeNull();
  });

  it('respects a language the visitor already chose', async () => {
    document.cookie = 'site_lang=en; path=/';
    setBrowserLanguages(['de']);
    expect(await site.detect('/about')).toBeNull();
    // No site data was needed to decide.
    http.expectNone('/api/v1/public/site');
  });

  it('keeps application pages on their address but shows them in the browser language', async () => {
    setBrowserLanguages(['de']);
    const result = site.detect('/apply');
    await tick();
    answerSite(http, 'en');
    expect(await result).toBeNull();

    const load = site.loadFor('/apply');
    answerSite(http, 'de');
    await load;
    expect(site.locale()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('remembers the language of an address the visitor arrived on', async () => {
    setBrowserLanguages(['en']);
    const load = site.use('en');
    answerSite(http, 'en');
    await load;
    expect(await site.detect('/sw/admissions')).toBeNull();
    expect(savedLanguage()).toBe('sw');
  });

  it('builds addresses in another language', async () => {
    const load = site.use('en');
    answerSite(http, 'en');
    await load;
    expect(site.localize('/admissions', 'sw')).toBe('/sw/admissions');
    expect(site.localize('/', 'de')).toBe('/de');
    expect(site.switchUrl('/sw/admissions', 'en')).toBe('/admissions');
    expect(site.switchUrl('/apply', 'de')).toBe('/apply');
  });
});

describe('SiteStore language detection (server rendering)', () => {
  let site: SiteStore;
  let http: HttpTestingController;

  function setUp(headers: Record<string, string>) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: REQUEST, useValue: new Request('http://localhost/apply', { headers }) },
      ],
    });
    site = TestBed.inject(SiteStore);
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => http.verify());

  it('leaves the redirect to the web server, but renders application pages in the browser language', async () => {
    setUp({ 'accept-language': 'en;q=0.5, de;q=0.9' });
    const onPage = site.detect('/admissions');
    await tick();
    answerSite(http, 'en');
    expect(await onPage).toBeNull();

    const load = site.loadFor('/apply');
    answerSite(http, 'de');
    await load;
    expect(site.locale()).toBe('de');
  });

  it('uses the saved language from the request cookie', async () => {
    setUp({ 'accept-language': 'de', cookie: 'site_lang=sw' });
    expect(await site.detect('/apply')).toBeNull();
    const load = site.loadFor('/apply');
    answerSite(http, 'sw');
    await load;
    expect(site.locale()).toBe('sw');
  });
});

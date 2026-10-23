import { HttpClient } from '@angular/common/http';
import { DOCUMENT, computed, inject, Injectable, REQUEST, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Language, MediaView, MenuLink, SiteData } from './models';

const MAIN_LANGUAGE = 'en';
/** Cookie that remembers the visitor's language for pages without a language in their address (e.g. /apply). */
const LANGUAGE_COOKIE = 'site_lang';
/** Addresses served by the application itself rather than the CMS: never given a language prefix. */
const APP_ROUTES = /^\/(admin|api|media|apply|preview|portal|login|assets|timetable|blog)(\/|$|[?#])/;

/**
 * Site-wide content edited in the admin: settings, interface text and menus, in the visitor's language.
 * Loaded once per language; server-side rendering transfers it to the browser without a second request.
 */
@Injectable({ providedIn: 'root' })
export class SiteStore {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly data = signal<SiteData | null>(null);
  private readonly loaded = new Map<string, Promise<SiteData>>();
  /** The browser's language picked on this first visit, until the cookie comes back with the next request. */
  private detected: string | null = null;

  readonly ready = computed(() => this.data() !== null);
  readonly institutionName = computed(() => this.setting<string>('institution.name') || '');
  /** The language the site is shown in, e.g. "fr". */
  readonly locale = computed(() => this.data()?.locale ?? MAIN_LANGUAGE);
  readonly languages = computed<Language[]>(() => this.data()?.languages ?? []);
  readonly language = computed(() => this.languages().find((l) => l.code === this.locale()) ?? null);

  /** Loads site content in the language of `url`: its /fr prefix, or the remembered language on application pages. */
  loadFor(url: string): Promise<void> {
    return this.use(this.localeOf(url));
  }

  /** Loads (English) site content; used by the admin portal. */
  load(): Promise<void> {
    return this.use(MAIN_LANGUAGE);
  }

  /** Switches the site to another language without changing the address (for application pages such as /apply). */
  async use(locale: string): Promise<void> {
    let pending = this.loaded.get(locale);
    if (!pending) {
      pending = firstValueFrom(this.http.get<SiteData>('/api/v1/public/site', { params: { locale } })).catch(() => {
        this.loaded.delete(locale);
        return { locale: MAIN_LANGUAGE, languages: [], settings: {}, media: {}, text: {}, menus: {} };
      });
      this.loaded.set(locale, pending);
    }
    const data = await pending;
    this.data.set(data);
    const root = this.document.documentElement;
    root.lang = data.locale;
    root.dir = data.languages.find((l) => l.code === data.locale)?.dir ?? 'ltr';
  }

  /** Remembers the visitor's choice so application pages (and later visits) use it too. */
  remember(locale: string) {
    try {
      this.document.cookie = `${LANGUAGE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      /* cookies unavailable */
    }
  }

  /**
   * First visit only (no remembered choice, no language in the address): if the browser asks for a site
   * language other than English, remembers it and returns the page in that language (e.g. "/about" -> "/fr/about").
   * Returns null when the page should stay as it is.
   */
  async detect(url: string): Promise<string | null> {
    if (this.rememberedLocale()) return null;
    const prefix = this.prefixOf(url);
    if (prefix) {
      // A server redirect cannot set the cookie, so remember the language once the page is in the browser.
      if (!this.request && this.languages().some((l) => l.code === prefix)) this.remember(prefix);
      return null;
    }
    const preferred = this.browserLocales();
    if (!preferred.length) return null;
    await this.use(MAIN_LANGUAGE);
    const codes = this.languages().map((l) => l.code);
    const match = preferred.find((code) => codes.includes(code));
    if (!match || match === MAIN_LANGUAGE) return null;
    this.detected = match;
    this.remember(match);
    // On the server, first visits to site pages are redirected by server.ts (which can also set the cookie).
    return APP_ROUTES.test(url) || this.request ? null : this.localize(url, match);
  }

  /** Adds the current language to a site address: "/admissions" -> "/fr/admissions". */
  localize(href: string, locale = this.locale()): string {
    if (!href.startsWith('/') || APP_ROUTES.test(href)) return href;
    const bare = this.stripLocale(href);
    if (locale === MAIN_LANGUAGE) return bare;
    return bare === '/' || /^\/[?#]/.test(bare) ? `/${locale}${bare.slice(1)}` : `/${locale}${bare}`;
  }

  /** The same page in another language: ("/fr/about", "sw") -> "/sw/about". Application pages keep their address. */
  switchUrl(url: string, locale: string): string {
    return APP_ROUTES.test(url) ? url : this.localize(url, locale);
  }

  isAppRoute(url: string) {
    return APP_ROUTES.test(url);
  }

  setting<T = unknown>(key: string): T | undefined {
    return this.data()?.settings[key] as T | undefined;
  }

  media(id: unknown): MediaView | null {
    return typeof id === 'number' ? (this.data()?.media[String(id)] ?? null) : null;
  }

  menu(location: string): MenuLink[] {
    return this.data()?.menus[location] ?? [];
  }

  /**
   * Editable interface text. Placeholders: {year}, {institution_name}, plus any in `vars`.
   * Falls back to the key's default so a label is never blank.
   */
  t(key: string, fallback = '', vars: Record<string, string | number> = {}): string {
    const raw = this.data()?.text[key] ?? fallback;
    const all: Record<string, string | number> = { year: new Date().getFullYear(), institution_name: this.institutionName(), ...vars };
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in all ? String(all[name]) : m));
  }

  /** "/fr/about" -> "/about" when French is a site language. */
  private stripLocale(href: string): string {
    const m = /^\/([a-z]{2})(?=$|[/?#])(.*)$/.exec(href);
    if (!m || !this.languages().some((l) => l.code === m[1] && l.code !== MAIN_LANGUAGE)) return href;
    return m[2].startsWith('/') ? m[2] : `/${m[2]}`;
  }

  private localeOf(url: string): string {
    if (APP_ROUTES.test(url)) return this.rememberedLocale() ?? this.detected ?? MAIN_LANGUAGE;
    // The API answers in English when the prefix is not a site language (e.g. a page at /it).
    return this.prefixOf(url) ?? MAIN_LANGUAGE;
  }

  private prefixOf(url: string): string | null {
    return /^\/([a-z]{2})(?=$|[/?#])/.exec(url)?.[1] ?? null;
  }

  /** Languages the browser asks for, most wanted first, as two-letter codes: "fr-CA,fr;q=0.9,en;q=0.8" -> ["fr", "en"]. */
  private browserLocales(): string[] {
    let tags: string[] = [];
    if (this.request) {
      tags = (this.request.headers.get('accept-language') ?? '')
        .split(',')
        .map((part) => {
          const [tag, ...params] = part.trim().split(';');
          const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
          return { tag, q: Number.isNaN(q) ? 0 : q };
        })
        .filter((p) => p.tag && p.tag !== '*' && p.q > 0)
        .sort((a, b) => b.q - a.q)
        .map((p) => p.tag);
    } else {
      const nav = this.document.defaultView?.navigator;
      tags = [...(nav?.languages ?? (nav?.language ? [nav.language] : []))];
    }
    return [...new Set(tags.map((t) => t.slice(0, 2).toLowerCase()))];
  }

  private rememberedLocale(): string | null {
    let cookies = '';
    try {
      cookies = this.request?.headers.get('cookie') ?? this.document.cookie ?? '';
    } catch {
      /* cookies unavailable */
    }
    const value = new RegExp(`(?:^|;\\s*)${LANGUAGE_COOKIE}=([a-z]{2})(?:;|$)`).exec(cookies)?.[1];
    return value ?? null;
  }
}

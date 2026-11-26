/**
 * A short-lived cache of server-rendered public pages, kept by the website server.
 *
 * Rendering a page costs about 40 ms of CPU, and at busy times most visitors open the same few pages,
 * so each page is rendered at most once per WEB_PAGE_CACHE_SECONDS (per website process) and reused.
 * Each copy served gets the visitor's own security nonce, so the page's Content-Security-Policy stays
 * per-request. Visitors who arrive while a page is being rendered wait for that render instead of
 * starting their own.
 *
 * Never cached: anything but GET, the admin portal, the applicant's own pages, sign-in, previews,
 * non-200 answers and answers that set a cookie. Server rendering does not send the visitor's sign-in
 * cookie to the API, so a cached page holds nothing personal.
 */

/** Same list as APP_ROUTES in core/site.ts: pages that never get a language prefix. */
export const APP_ROUTES = /^\/(admin|api|media|apply|preview|portal|login|assets|timetable|blog|gallery|staff|downloads)(\/|$|[?#])/;

/** Pages that are personal or private: always rendered fresh. */
const NEVER_CACHED = /^\/(admin|portal|login|preview|apply\/application|apply\/reset-password)(\/|$)/;

export interface RenderedPage {
  status: number;
  headers: [string, string][];
  body: string;
  /** The nonce the page was rendered with, swapped for each visitor's own when served from the cache. */
  nonce: string | null;
  cacheable: boolean;
}

interface Entry {
  page: RenderedPage;
  storedAt: number;
}

export interface CacheRequest {
  method: string;
  path: string;
  originalUrl: string;
  headers: { cookie?: string; 'accept-language'?: string };
}

/** Seconds from WEB_PAGE_CACHE_SECONDS; 30 in production and off elsewhere when not set. */
export function pageCacheSeconds(setting: string | undefined, production: boolean): number {
  if (setting === undefined || setting.trim() === '') return production ? 30 : 0;
  const n = Number(setting);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 0;
}

/**
 * The cache key for a request, or null when it must not be cached. Pages without a language in their
 * address that pick the language from the visitor (the app pages: apply, blog, timetable) also key on
 * the language cookie and the browser's languages.
 */
export function cacheKey(req: CacheRequest): string | null {
  if (req.method !== 'GET' || NEVER_CACHED.test(req.path) || req.originalUrl.length > 300) return null;
  if (!APP_ROUTES.test(req.path)) return req.originalUrl;
  const lang = /(?:^|;\s*)site_lang=([a-z]{2})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
  const browser = (req.headers['accept-language'] ?? '')
    .split(',')
    .map((part) => part.trim().slice(0, 2).toLowerCase())
    .filter(Boolean)
    .slice(0, 3)
    .join(',');
  return `${req.originalUrl}|${lang}|${browser}`;
}

/** The page's HTML with the nonce it was rendered with replaced by this visitor's. */
export function withNonce(page: RenderedPage, nonce: string | null): string {
  return page.nonce && nonce && page.nonce !== nonce ? page.body.split(page.nonce).join(nonce) : page.body;
}

export type CacheSource = 'hit' | 'miss' | 'shared';

export class PageCache {
  private readonly pages = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<RenderedPage | null>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get size(): number {
    return this.pages.size;
  }

  /**
   * The cached page for the key, or the page from a render already under way for it, or a new render.
   * `render` returns null when the request is not a page (the next handler takes it).
   */
  async lookup(
    key: string,
    render: () => Promise<RenderedPage | null>,
  ): Promise<{ page: RenderedPage | null; source: CacheSource }> {
    const hit = this.fresh(key);
    if (hit) return { page: hit, source: 'hit' };

    const inFlight = this.pending.get(key);
    if (inFlight) {
      const shared = await inFlight.catch(() => null);
      if (shared) return { page: shared, source: 'shared' };
      return { page: await render(), source: 'miss' };
    }

    const rendering = render();
    const sharable = rendering.then((page) => (page?.cacheable ? page : null));
    this.pending.set(key, sharable);
    try {
      const page = await rendering;
      if (page?.cacheable) this.store(key, page);
      return { page, source: 'miss' };
    } finally {
      this.pending.delete(key);
      // A failed render must not leave an unhandled rejection behind for nobody.
      sharable.catch(() => undefined);
    }
  }

  private fresh(key: string): RenderedPage | null {
    const entry = this.pages.get(key);
    if (!entry) return null;
    if (this.now() - entry.storedAt >= this.ttlMs) {
      this.pages.delete(key);
      return null;
    }
    // Most recently used goes to the end, so the least used is dropped first when full.
    this.pages.delete(key);
    this.pages.set(key, entry);
    return entry.page;
  }

  private store(key: string, page: RenderedPage): void {
    this.pages.delete(key);
    this.pages.set(key, { page, storedAt: this.now() });
    while (this.pages.size > this.maxEntries) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
    }
  }
}

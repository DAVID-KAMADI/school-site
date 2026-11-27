import { isPlatformBrowser } from '@angular/common';
import { DOCUMENT, effect, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { CookieConsent } from '../shared/cookie-consent';

const ENDPOINT = '/api/v1/public/analytics';
/** Random visitor ID, only for visitors who accepted all cookies. */
const VISITOR_KEY = 'site_vid';
const HEARTBEAT_MS = 30_000;
const FILE = /\.(pdf|docx?|xlsx?|pptx?|csv|zip|rar|odt|ods|txt|rtf|jpe?g|png)$/i;

interface CustomEventRule {
  name: string;
  type: 'click' | 'link';
  value: string;
}

interface Item {
  t: 'pageview' | 'engage' | 'event';
  [key: string]: unknown;
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The website's own analytics tracker (Admin → Web analytics). Lightweight and fail-safe: it never
 * blocks the page, and any error is swallowed.
 *
 * Privacy: never reads form fields, never sends query strings (the server strips them too), honours
 * Do Not Track / Global Privacy Control. A visitor who accepted all cookies gets a random ID in
 * localStorage so they can be recognised when they come back; everyone else is counted with an ID that
 * only lives in memory for this page load, so nothing is stored on their device.
 */
@Injectable({ providedIn: 'root' })
export class Analytics {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly consent = inject(CookieConsent);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  private started = false;
  private enabled = false;
  private rules: CustomEventRule[] = [];
  /** This page load only; never stored. */
  private readonly tab = this.browser ? randomHex(16) : '';
  private first = true;
  private lastPath = '';

  /** The page view being read: its id from the server, and visible time so far. */
  private current: { pv: Promise<string | null>; ms: number; since: number | null } | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (!this.browser) return;
    // Cookie choice changed: forget the ID straight away when someone switches to essential only.
    effect(() => {
      if (this.consent.choice() !== 'all') this.forgetVisitor();
    });
  }

  /** Started once by the public layout. Does nothing on the server or in the admin portal. */
  start() {
    if (!this.browser || this.started) return;
    this.started = true;
    void this.init().catch(() => undefined);
  }

  /** Records an event, e.g. analytics.track('sign_up', 'apply'). Names: lower case, digits and _. */
  track(name: string, category = 'custom', label?: string | null) {
    if (!this.enabled) return;
    this.send([{ t: 'event', name, category, label: label ?? null, path: location.pathname, cid: randomHex(8) }]);
  }

  private async init() {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.webdriver) return;
    const res = await fetch(`${ENDPOINT}/config`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const config = (await res.json()) as { enabled: boolean; respectDoNotTrack: boolean; customEvents: CustomEventRule[] };
    if (!config.enabled) return;
    if (config.respectDoNotTrack && (nav.doNotTrack === '1' || nav.globalPrivacyControl === true)) return;
    this.enabled = true;
    this.rules = config.customEvents ?? [];

    this.pageView();
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.pageView();
    });
    this.document.addEventListener('click', (e) => this.onClick(e), { capture: true, passive: true });
    this.document.addEventListener('visibilitychange', () => (this.document.visibilityState === 'hidden' ? this.pause(true) : this.resume()));
    addEventListener('pagehide', () => this.pause(true));
  }

  private pageView() {
    const path = location.pathname;
    if (path.startsWith('/admin') || path === this.lastPath) return;
    this.lastPath = path;
    this.leavePage();

    const item: Item = { t: 'pageview', path, sw: screen.width || innerWidth };
    if (this.first) {
      this.first = false;
      const params = new URLSearchParams(location.search);
      const utm: Record<string, string> = {};
      for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
        const v = params.get(`utm_${k}`);
        if (v) utm[k] = v;
      }
      if (Object.keys(utm).length) item['utm'] = utm;
      try {
        const ref = this.document.referrer ? new URL(this.document.referrer) : null;
        if (ref && ref.host !== location.host) item['ref'] = ref.origin + '/';
      } catch {
        /* no referrer */
      }
    }

    // Give the page a moment to set its title (it is set after its data loads).
    const pv = new Promise<string | null>((resolve) =>
      setTimeout(() => {
        item['title'] = this.document.title;
        this.post([item], true)
          .then((r) => resolve(r?.pv?.[0] ?? null))
          .catch(() => resolve(null));
      }, 400),
    );
    this.current = { pv, ms: 0, since: this.document.visibilityState === 'visible' ? performance.now() : null };
    this.heartbeat ??= setInterval(() => this.report(false), HEARTBEAT_MS);
  }

  /** Visible time on the current page, sent cumulatively (the server keeps the highest value). */
  private report(closing: boolean) {
    const c = this.current;
    if (!c) return;
    const ms = c.ms + (c.since !== null ? performance.now() - c.since : 0);
    if (ms < 1000 || (!closing && c.since === null)) return;
    void c.pv.then((pv) => pv && this.send([{ t: 'engage', pv, ms: Math.round(ms) }]));
  }

  private leavePage() {
    this.report(true);
    this.current = null;
  }

  private pause(closing: boolean) {
    const c = this.current;
    if (c && c.since !== null) {
      c.ms += performance.now() - c.since;
      c.since = null;
    }
    if (closing) this.report(true);
  }

  private resume() {
    if (this.current && this.current.since === null) this.current.since = performance.now();
  }

  private onClick(e: MouseEvent) {
    try {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || location.pathname.startsWith('/admin')) return;

      for (const rule of this.rules)
        if (rule.type === 'click' && safeClosest(target, rule.value)) this.track(rule.name, 'click', label(target));

      const tagged = target.closest<HTMLElement>('[data-track]');
      if (tagged?.dataset['track']) this.track(tagged.dataset['track'], 'click', label(tagged));

      const link = target.closest('a');
      const href = link?.getAttribute('href');
      if (!link || !href) return;
      for (const rule of this.rules) if (rule.type === 'link' && href.includes(rule.value)) this.track(rule.name, 'link', href.slice(0, 200));

      if (/^tel:/i.test(href)) return this.track('contact_click', 'contact', 'Phone');
      if (/^mailto:/i.test(href)) return this.track('contact_click', 'contact', 'Email');
      const url = new URL(href, location.href);
      if (/(^|\.)(wa\.me|whatsapp\.com)$/i.test(url.hostname)) return this.track('contact_click', 'contact', 'WhatsApp');
      if (url.pathname.startsWith('/media/') || FILE.test(url.pathname) || link.hasAttribute('download'))
        return this.track('file_download', 'download', decodeURIComponent(url.pathname.split('/').pop() || url.pathname).slice(0, 200));
      if (url.host !== location.host && /^https?:$/.test(url.protocol)) this.track('outbound_click', 'outbound', url.hostname);
    } catch {
      /* never break a click */
    }
  }

  private send(items: Item[]) {
    void this.post(items, false).catch(() => undefined);
  }

  private async post(items: Item[], wantReply: boolean): Promise<{ pv: (string | null)[] } | null> {
    const body = JSON.stringify({ v: this.visitorId(), s: this.tab, items });
    // keepalive lets the request finish while the page closes (bodies up to 64 KB).
    const res = await fetch(`${ENDPOINT}/collect`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
    });
    return wantReply && res.ok ? ((await res.json()) as { pv: (string | null)[] }) : null;
  }

  private visitorId(): string | null {
    if (this.consent.choice() !== 'all') return null;
    try {
      let id = localStorage.getItem(VISITOR_KEY);
      if (!id || !/^[0-9a-f]{32}$/.test(id)) {
        id = randomHex(16);
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch {
      return null;
    }
  }

  private forgetVisitor() {
    try {
      localStorage.removeItem(VISITOR_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

function safeClosest(el: Element, selector: string) {
  try {
    return el.closest(selector);
  } catch {
    return null;
  }
}

/** Short visible text of what was clicked: never the value of a form field. */
function label(el: Element): string | null {
  const text = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 100) : null;
}

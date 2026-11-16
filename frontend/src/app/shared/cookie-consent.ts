import { isPlatformBrowser } from '@angular/common';
import { DOCUMENT, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

/**
 * The visitor's cookie choice: "all" (also the video players' own cookies) or "essential"
 * (only what the site needs). null until they choose, which shows the cookie notice.
 */
export type CookieChoice = 'all' | 'essential';

/** Remembers the choice itself; an essential cookie, kept for a year. */
const CONSENT_COOKIE = 'cookie_consent';

@Injectable({ providedIn: 'root' })
export class CookieConsent {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  /** Always null on the server, so cached pages never carry one visitor's choice to another. */
  readonly choice = signal<CookieChoice | null>(this.read());

  choose(choice: CookieChoice) {
    this.choice.set(choice);
    try {
      this.document.cookie = `${CONSENT_COOKIE}=${choice}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      /* cookies unavailable: the notice comes back on the next visit */
    }
  }

  private read(): CookieChoice | null {
    if (!this.browser) return null;
    try {
      const value = new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(all|essential)(?:;|$)`).exec(this.document.cookie)?.[1];
      return (value as CookieChoice | undefined) ?? null;
    } catch {
      return null;
    }
  }
}

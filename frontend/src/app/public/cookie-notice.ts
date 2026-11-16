import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID } from '@angular/core';
import { SiteStore } from '../core/site';
import { CmsLink } from '../shared/cms-link';
import { CookieConsent } from '../shared/cookie-consent';

/**
 * Cookie notice at the bottom of the public site until the visitor chooses. Shown only in the
 * browser, so server-rendered (and cached) pages are the same for everyone. Wording: Interface text → cookies.*
 */
@Component({
  selector: 'app-cookie-notice',
  imports: [CmsLink],
  template: `
    @if (visible()) {
      <section class="cookie-notice" role="region" aria-label="Cookies">
        <div class="container cookie-notice__inner">
          <p>
            {{ site.t('cookies.message', 'We use cookies to keep you signed in, remember your language and keep this site secure. Videos from YouTube or Vimeo may set their own cookies when you play them.') }}
            <app-cms-link linkClass="cookie-notice__link" [link]="{ label: site.t('cookies.details', 'Cookie details'), href: detailsHref() }" />
          </p>
          <div class="cookie-notice__actions">
            <button type="button" class="btn btn--outline" (click)="consent.choose('essential')">
              {{ site.t('cookies.essential', 'Essential only') }}
            </button>
            <button type="button" class="btn btn--primary" (click)="consent.choose('all')">
              {{ site.t('cookies.accept', 'Accept all') }}
            </button>
          </div>
        </div>
      </section>
    }
  `,
  styles: `
    .cookie-notice {
      position: fixed; inset: auto 0 0 0; z-index: 90;
      background: var(--surface); color: var(--text);
      border-top: 1px solid var(--line); box-shadow: 0 -6px 24px rgb(16 24 40 / 0.12);
      animation: rise 0.25s ease;
    }
    .cookie-notice__inner { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: center; justify-content: space-between; padding-block: 0.9rem; }
    p { margin: 0; flex: 1 1 32rem; font-size: 0.95rem; }
    :host ::ng-deep .cookie-notice__link { color: var(--action); font-weight: 600; white-space: nowrap; }
    .cookie-notice__actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }
    @keyframes rise { from { translate: 0 100%; } }
    @media (prefers-reduced-motion: reduce) { .cookie-notice { animation: none; } }
  `,
})
export class CookieNotice {
  protected readonly site = inject(SiteStore);
  protected readonly consent = inject(CookieConsent);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly visible = computed(() => this.browser && this.site.ready() && this.consent.choice() === null);

  /** The Privacy Policy (section 9 lists the cookies): the legal menu's privacy link, else the default address. */
  protected readonly detailsHref = computed(
    () => this.site.menu('legal').find((l) => /privacy/i.test(l.href) || /privacy/i.test(l.label))?.href ?? '/privacy-policy',
  );
}

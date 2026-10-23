import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { SiteStore } from '../core/site';

/**
 * Lets visitors read the site in another language. Each choice is a real link to the same page
 * in that language (/fr/admissions), so it works without JavaScript and search engines can follow it.
 * Hidden while the site has only one language.
 */
@Component({
  selector: 'app-language-switcher',
  imports: [RouterLink],
  template: `
    @if (site.languages().length > 1) {
      <div class="lang" (keydown.escape)="close(true)">
        <button
          type="button"
          class="lang__toggle"
          [attr.aria-expanded]="open()"
          aria-controls="language-list"
          [attr.aria-label]="label() + ': ' + (site.language()?.name ?? '')"
          (click)="open.set(!open())"
        >
          <svg class="lang__icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.6" />
          </svg>
          <span class="lang__current">{{ site.language()?.name }}</span>
        </button>
        <ul id="language-list" class="lang__list" [class.lang__list--open]="open()">
          @for (l of site.languages(); track l.code) {
            <li>
              <a
                [routerLink]="target(l.code).path"
                [queryParams]="target(l.code).query"
                [attr.lang]="l.code"
                [attr.hreflang]="l.code"
                [attr.dir]="l.dir"
                [attr.aria-current]="l.code === site.locale() ? 'true' : null"
                (click)="choose(l.code)"
                >{{ l.name }}</a
              >
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .lang { position: relative; }
    .lang__toggle {
      display: inline-flex; align-items: center; gap: 0.35rem; min-height: 1.9rem; padding: 0.15rem 0.65rem;
      border: 1px solid rgb(255 255 255 / 0.5); border-radius: 999px; background: transparent; color: inherit;
      font: inherit; font-size: 0.85rem; cursor: pointer;
    }
    .lang__toggle:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .lang__icon { flex: none; }
    .lang__list {
      position: absolute; inset-inline-end: 0; top: calc(100% + 0.4rem); z-index: 60; min-width: 11rem;
      margin: 0; padding: 0.35rem; list-style: none; border-radius: 0.6rem;
      background: var(--surface, #fff); color: var(--text, #1a1a1a); box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
      display: none;
    }
    .lang__list--open { display: block; }
    .lang .lang__list a { display: block; padding: 0.55rem 0.75rem; font-size: 0.95rem; border-radius: 0.4rem; color: var(--text, #1a1a1a); text-decoration: none; }
    .lang .lang__list a:hover, .lang .lang__list a:focus-visible { background: var(--surface-2, #f2f2f2); color: var(--ink, #111); text-decoration: none; }
    .lang__list a[aria-current='true'] { font-weight: 700; }
  `,
})
export class LanguageSwitcher {
  protected readonly site = inject(SiteStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly open = signal(false);
  protected readonly label = computed(() => this.site.t('common.language', 'Language'));
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The current page in another language, split for routerLink. */
  protected target(locale: string) {
    const url = this.router.parseUrl(this.site.switchUrl(this.url(), locale));
    const path = '/' + (url.root.children['primary']?.segments.map((s) => s.path).join('/') ?? '');
    return { path, query: url.queryParams };
  }

  protected choose(locale: string) {
    this.site.remember(locale);
    this.open.set(false);
    // Application pages (e.g. /apply) keep their address, so switch their text in place.
    if (this.site.isAppRoute(this.url())) void this.site.use(locale);
  }

  protected close(focusToggle = false) {
    if (!this.open()) return;
    this.open.set(false);
    if (focusToggle) this.host.nativeElement.querySelector<HTMLButtonElement>('.lang__toggle')?.focus();
  }

  @HostListener('document:click', ['$event'])
  protected outside(e: MouseEvent) {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close();
  }
}

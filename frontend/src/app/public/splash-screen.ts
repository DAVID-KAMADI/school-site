import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, afterNextRender, computed, inject, signal } from '@angular/core';
import { SiteStore } from '../core/site';
import { MediaImage } from '../shared/media-image';

/** Long enough for the drawing to finish, so a fast page does not flash the screen. */
const MIN_SHOWN_MS = 2600;
const MIN_SHOWN_REDUCED_MS = 700;
/** A slow or broken page never holds the visitor behind the screen for longer than this. */
const MAX_SHOWN_MS = 5000;
/** Length of the lift-away transition in the styles below. */
const LEAVE_MS = 750;

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Welcome screen shown whenever the site is opened or refreshed: the logo, a school building
 * drawn line by line, the institution name and tagline. It lifts away once the
 * page has loaded. Rendered on the server so it is the first thing on screen; turned on or off
 * under Site settings → Banners → Welcome screen.
 */
@Component({
  selector: 'app-splash-screen',
  imports: [MediaImage],
  template: `
    @if (enabled() && visible()) {
      <div class="splash" [class.splash--leaving]="leaving()" role="status">
        <span class="visually-hidden">{{ site.t('splash.loading', 'Loading {institution_name}') }}</span>
        <div class="splash__inner" aria-hidden="true">
          <!-- With a logo: logo, name, then the building drawn line by line. Without: building, then name. -->
          @if (logo(); as img) {
            <span class="splash__logo"><app-media-image [media]="img" sizes="240px" [eager]="true" [decorative]="true" /></span>
            @if (site.institutionName()) {
              <p class="splash__name splash__name--with-logo">{{ site.institutionName() }}</p>
            }
          }
          <svg class="splash__art" [class.splash__art--below]="logo()" viewBox="0 0 240 140" focusable="false">
            <path class="ln ln--ground" pathLength="100" d="M8,130 H232" />
            <path class="ln ln--wing-l" pathLength="100" d="M24,130 V84 H76" />
            <path class="ln ln--wing-r" pathLength="100" d="M216,130 V84 H164" />
            <path class="ln ln--block" pathLength="100" d="M76,130 V66 H164 V130" />
            <path class="ln ln--roof" pathLength="100" d="M66,68 L120,36 L174,68" />
            <path class="ln ln--door" pathLength="100" d="M108,130 V106 Q120,98 132,106 V130" />
            <circle class="ln ln--clock" pathLength="100" cx="120" cy="54" r="6" />
            <path class="ln ln--pole" pathLength="100" d="M120,36 V8" />
            <path class="flag" d="M120,8 L142,13 L120,18 Z" />
            <rect class="win win--1" x="32" y="94" width="10" height="14" rx="1.5" />
            <rect class="win win--2" x="45" y="94" width="10" height="14" rx="1.5" />
            <rect class="win win--3" x="58" y="94" width="10" height="14" rx="1.5" />
            <rect class="win win--1" x="198" y="94" width="10" height="14" rx="1.5" />
            <rect class="win win--2" x="185" y="94" width="10" height="14" rx="1.5" />
            <rect class="win win--3" x="172" y="94" width="10" height="14" rx="1.5" />
            <rect class="win win--4" x="86" y="80" width="12" height="16" rx="1.5" />
            <rect class="win win--4" x="142" y="80" width="12" height="16" rx="1.5" />
          </svg>
          @if (!logo() && site.institutionName()) {
            <p class="splash__name">{{ site.institutionName() }}</p>
          }
          @if (site.setting('institution.tagline'); as tagline) {
            <p class="splash__tagline">{{ tagline }}</p>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .splash {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      background: radial-gradient(120% 90% at 50% 30%, var(--primary) 0%, var(--primary-deep) 100%);
      color: var(--on-primary);
      transition: transform ${LEAVE_MS}ms cubic-bezier(0.7, 0, 0.3, 1), opacity ${LEAVE_MS}ms ease;
      /* If the app never starts, the screen still goes away. */
      animation: splash-failsafe 0s linear ${MAX_SHOWN_MS + 1500}ms forwards;
    }
    .splash--leaving { transform: translateY(-100%); opacity: 0; pointer-events: none; }

    .splash__inner { width: min(420px, 100%); text-align: center; }
    /* The logo sits straight on the blue (it is white), with a soft shadow for depth. */
    .splash__logo {
      display: block; width: fit-content; margin: 0 auto;
      filter: drop-shadow(0 8px 22px rgb(0 0 0 / 0.3));
      opacity: 0; animation: rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) 0.05s forwards;
    }
    .splash__logo ::ng-deep img { height: clamp(5rem, 18vw, 6.5rem); width: auto; max-width: 60vw; object-fit: contain; }
    /* With a logo the name follows it straight away; the building is drawn below them. */
    .splash__name--with-logo { margin-top: 1.1rem; animation-delay: 0.45s; }
    .splash__art--below { margin-top: 1.25rem; max-height: 130px; }
    .splash__art { display: block; width: 100%; height: auto; max-height: 170px; overflow: visible; }
    .splash__name, .splash__tagline { margin: 0; opacity: 0; animation: rise 0.5s ease forwards; }
    .splash__name { margin-top: 1.4rem; font-size: clamp(1.35rem, 4vw, 1.75rem); font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; animation-delay: 1.2s; }
    .splash__tagline { margin-top: 0.6rem; font-size: 1rem; line-height: 1.45; opacity: 0; color: rgb(255 255 255 / 0.82); animation-delay: 1.45s; }

    .ln {
      fill: none;
      stroke: var(--on-primary);
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 100;
      stroke-dashoffset: 100;
      /* Hidden until its turn: a round cap on a not-yet-drawn line would show as a dot. */
      opacity: 0;
      animation: draw 0.45s cubic-bezier(0.35, 0.8, 0.45, 1) both;
    }
    .ln--ground { stroke: rgb(255 255 255 / 0.3); stroke-width: 2; animation-delay: 0.1s; animation-duration: 0.35s; }
    .ln--wing-l, .ln--wing-r { animation-delay: 0.3s; }
    .ln--block { animation-delay: 0.5s; animation-duration: 0.5s; }
    .ln--roof { animation-delay: 0.85s; }
    .ln--door { animation-delay: 1s; animation-duration: 0.3s; }
    .ln--clock { stroke: var(--accent); animation-delay: 1.15s; animation-duration: 0.3s; }
    .ln--pole { animation-delay: 1.2s; animation-duration: 0.3s; }
    .flag { fill: var(--accent); opacity: 0; transform-origin: 120px 13px; animation: wave 0.5s ease 1.45s forwards; }
    .win { fill: var(--accent); opacity: 0; animation: light 0.3s ease forwards; filter: drop-shadow(0 0 4px rgb(239 109 0 / 0.6)); }
    .win--1 { animation-delay: 1.3s; }
    .win--4 { animation-delay: 1.38s; }
    .win--2 { animation-delay: 1.46s; }
    .win--3 { animation-delay: 1.54s; }

    @keyframes draw { 0% { opacity: 0; } 1% { opacity: 1; } 100% { opacity: 1; stroke-dashoffset: 0; } }
    @keyframes light { to { opacity: 0.9; } }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes wave { from { opacity: 0; transform: scaleX(0.2); } to { opacity: 1; transform: none; } }
    @keyframes splash-failsafe { to { visibility: hidden; opacity: 0; pointer-events: none; } }

    @media (prefers-reduced-motion: reduce) {
      .splash { transition: opacity 0.3s ease; }
      .splash--leaving { transform: none; }
      .ln, .flag, .win, .splash__logo, .splash__name, .splash__tagline { animation: none; stroke-dashoffset: 0; opacity: 1; }
      .win { opacity: 0.9; }
    }
  `,
})
export class SplashScreen {
  protected readonly site = inject(SiteStore);
  /** On unless the admin has switched it off; sites without the setting yet still show it. */
  protected readonly enabled = computed(() => this.site.setting<{ enabled?: boolean }>('banner.welcome_screen')?.enabled !== false);
  protected readonly logo = computed(() => this.site.media(this.site.setting('institution.logo_media_id')));
  protected readonly visible = signal(true);
  protected readonly leaving = signal(false);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => {
      const min = reducedMotion() ? MIN_SHOWN_REDUCED_MS : MIN_SHOWN_MS;
      // performance.now() counts from the start of the visit, i.e. since the server-rendered screen appeared.
      const finish = () => setTimeout(() => this.reveal(), Math.max(0, min - performance.now()));
      if (document.readyState === 'complete') finish();
      else window.addEventListener('load', finish, { once: true });
      setTimeout(() => this.reveal(), Math.max(0, MAX_SHOWN_MS - performance.now()));
    });
  }

  private reveal() {
    if (this.leaving() || !this.visible()) return;
    this.leaving.set(true);
    // The first screen's entrance (shared/motion.ts) waits for this.
    window.dispatchEvent(new Event('splash-leave'));
    setTimeout(() => this.visible.set(false), LEAVE_MS);
  }
}

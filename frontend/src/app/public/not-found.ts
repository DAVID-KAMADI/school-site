import { Location, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, PLATFORM_ID, afterNextRender, computed, inject, input, signal, type OnDestroy } from '@angular/core';
import { Router, RouterLink, type ActivatedRouteSnapshot } from '@angular/router';
import type { MenuLink } from '../core/models';
import { SiteStore } from '../core/site';
import { CmsLink } from '../shared/cms-link';
import { loadAnime, motionAllowed } from '../shared/motion';

type Anime = typeof import('../shared/anime');

/**
 * True when the route being shown is a "page not found" (an unknown address, or a blog story that doesn't exist).
 * The public layout then leaves out the header, banners and footer, so the 404 page stands on its own.
 * Worked out from the resolved route, before anything renders, so the server and browser agree.
 * An unpublished home page is not a 404: it shows the "being set up" welcome inside the normal layout.
 */
export function isNotFoundRoute(route: ActivatedRouteSnapshot, site: SiteStore): boolean {
  let leaf = route;
  while (leaf.firstChild) leaf = leaf.firstChild;
  if (leaf.routeConfig?.path === 'blog/:slug') return leaf.data['post'] === null;
  if ((leaf.data['result'] as { kind?: string } | undefined)?.kind !== 'not_found') return false;
  const path = '/' + leaf.pathFromRoot.flatMap((r) => r.url.map((u) => u.path)).join('/');
  return site.localize(path, 'en') !== '/';
}

/** Twinkling dots around the scene: x, y and size in the scene's coordinates. */
const SPARKS: [number, number, number][] = [
  [70, 60, 3], [560, 48, 2.5], [600, 230, 3], [40, 240, 2], [470, 18, 2], [150, 286, 2.5], [330, 8, 2],
];

/**
 * "Page not found": a big 404 whose zero is a compass hunting for the lost page, with a paper aeroplane
 * circling it. Everything moves with Anime.js: the digits drop in on a spring, the compass ring draws itself,
 * the heading rises letter by letter, and visitors can pull the digits about (they spring back).
 * The server sends the finished, still page (with HTTP 404); movement is added in the browser only,
 * and not at all when the visitor's device asks for less motion or the admin has switched animations off.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, CmsLink],
  template: `
    <section class="nf container">
      <div class="nf__scene" aria-hidden="true">
        <svg class="nf__sky" viewBox="0 0 640 300" focusable="false">
          <path
            class="nf__route"
            d="M320,30 C540,30 640,120 580,200 C520,285 120,285 60,200 C0,120 100,30 320,30 Z"
          />
          @for (s of sparks; track $index) {
            <circle class="nf__spark" [attr.cx]="s[0]" [attr.cy]="s[1]" [attr.r]="s[2]" />
          }
          <g class="nf__plane" transform="translate(320 30)">
            <path class="nf__plane-body" d="M16,0 L-13,-10 L-6,0 L-13,10 Z" />
            <path class="nf__plane-fold" d="M16,0 L-6,0 L-9,6" />
          </g>
        </svg>

        <div class="nf__digits">
          <span class="nf__slot"><span class="nf__float"><span class="nf__drag nf__digit">4</span></span></span>
          <span class="nf__slot">
            <span class="nf__float">
              <span class="nf__drag nf__zero">
                <svg viewBox="0 0 100 140" focusable="false">
                  <ellipse class="nf__ring" cx="50" cy="70" rx="38" ry="56"/>
                  <ellipse class="nf__ring-inner" cx="50" cy="70" rx="25" ry="40" />
                  <g class="nf__ticks">
                    <path d="M50,24 V31 M50,109 V116 M17,70 H24 M76,70 H83" />
                  </g>
                  <g class="nf__needle">
                    <path class="nf__needle-n" d="M50,36 L57,70 L43,70 Z" />
                    <path class="nf__needle-s" d="M50,104 L57,70 L43,70 Z" />
                    <circle class="nf__pin" cx="50" cy="70" r="4" />
                  </g>
                </svg>
              </span>
            </span>
          </span>
          <span class="nf__slot"><span class="nf__float"><span class="nf__drag nf__digit">4</span></span></span>
        </div>
      </div>

      <div class="nf__copy">
        <p class="nf__eyebrow eyebrow">{{ site.t('error.not_found_eyebrow', 'Error 404') }}</p>
        <h1 class="nf__title">{{ title() || site.t('error.not_found_title', 'Page not found') }}</h1>
        <p class="nf__text">{{ text() || site.t('error.not_found_text', 'The page you are looking for may have moved.') }}</p>
        <div class="nf__buttons button-row">
          <a [routerLink]="homeLink() || site.localize('/')" class="btn btn--primary btn--lg">{{ homeLabel() || site.t('error.go_home', 'Go to the home page') }}</a>
          <button type="button" class="btn btn--outline btn--lg" (click)="back()">{{ site.t('error.go_back', 'Go back') }}</button>
        </div>

        @if (links().length) {
          <nav class="nf__more" [attr.aria-label]="site.t('error.popular_pages', 'Popular pages')">
            <p class="nf__more-title">{{ site.t('error.try_these', 'Or try one of these') }}</p>
            <ul class="nf__links">
              @for (link of links(); track link.href) {
                <li class="nf__link"><app-cms-link [link]="link" linkClass="nf__chip" /></li>
              }
            </ul>
          </nav>
        }

        @if (playful()) {
          <p class="nf__hint">{{ site.t('error.drag_hint', 'Psst: you can grab the numbers.') }}</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; overflow: hidden; }
    .nf { padding-block: clamp(2rem, 6vw, 4.5rem) var(--section-space); text-align: center; }

    /* Scene: the aeroplane's route surrounds the digits. */
    .nf__scene { position: relative; width: min(640px, 100%); margin: 0 auto; aspect-ratio: 640 / 300; }
    .nf__sky { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .nf__route { fill: none; stroke: var(--primary); stroke-opacity: 0.18; stroke-width: 2; stroke-dasharray: 2 9; stroke-linecap: round; }
    .nf__spark { fill: var(--accent); opacity: 0.55; transform-box: fill-box; transform-origin: center; }
    .nf__plane { transform-box: view-box; transform-origin: 0 0; }
    .nf__plane-body { fill: #fff; stroke: var(--primary); stroke-width: 2; stroke-linejoin: round; }
    .nf__plane-fold { fill: none; stroke: var(--primary); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }

    .nf__digits {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center; gap: clamp(0.25rem, 2vw, 1rem);
    }
    .nf__slot, .nf__float, .nf__drag { display: block; }
    .nf__drag { touch-action: none; user-select: none; -webkit-user-select: none; }
    .nf__digit {
      font-size: clamp(6rem, 24vw, 11.5rem); font-weight: 800; line-height: 1; letter-spacing: -0.04em;
      color: var(--primary);
      text-shadow: 0 0.06em 0 var(--primary-deep), 0 0.14em 0.3em rgb(0 26 92 / 0.18);
    }
    .nf__zero svg { display: block; height: clamp(6.2rem, 25vw, 12rem); width: auto; overflow: visible; filter: drop-shadow(0 0.6rem 1rem rgb(0 26 92 / 0.18)); }
    .nf__ring { fill: #fff; stroke: var(--primary); stroke-width: 13; }
    .nf__ring-inner { fill: none; stroke: var(--primary); stroke-opacity: 0.15; stroke-width: 1.5; }
    .nf__ticks path { stroke: var(--primary); stroke-opacity: 0.45; stroke-width: 2.5; stroke-linecap: round; }
    .nf__needle { transform-box: view-box; transform-origin: 50px 70px; transform: rotate(35deg); }
    .nf__needle-n { fill: var(--accent); }
    .nf__needle-s { fill: var(--primary); opacity: 0.35; }
    .nf__pin { fill: var(--primary-deep); }

    .nf__copy { max-width: 38rem; margin: clamp(1rem, 3vw, 2rem) auto 0; }
    .nf__eyebrow { margin-bottom: 0.5rem; }
    .nf__title { margin: 0 0 0.75rem; }
    .nf__text { margin: 0 auto 1.75rem; color: var(--muted); font-size: 1.125rem; max-width: 46ch; }
    .nf__buttons { justify-content: center; }

    .nf__more { margin-top: 2.5rem; padding-top: 1.75rem; border-top: 1px solid var(--line); }
    .nf__more-title { margin: 0 0 0.9rem; color: var(--muted); font-size: 0.95rem; font-weight: 600; }
    .nf__links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.6rem; margin: 0; padding: 0; list-style: none; }
    .nf__links ::ng-deep .nf__chip {
      display: inline-flex; align-items: center; min-height: 2.5rem; padding: 0.4rem 1rem;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface-2);
      color: var(--ink); font-weight: 600; text-decoration: none;
      transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
    }
    .nf__links ::ng-deep .nf__chip:hover { border-color: var(--primary); background: var(--primary); color: var(--on-primary); transform: translateY(-2px); }
    .nf__hint { margin: 1.75rem 0 0; color: var(--muted); font-size: 0.85rem; }
  `,
})
export class NotFound implements OnDestroy {
  protected readonly site = inject(SiteStore);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Override the wording (e.g. for a missing blog story); the editable site text is used otherwise. */
  readonly title = input('');
  readonly text = input('');
  readonly homeLink = input('');
  readonly homeLabel = input('');

  protected readonly sparks = SPARKS;
  /** Shown once the digits can actually be dragged. */
  protected readonly playful = signal(false);
  /** The main menu's top-level pages, as somewhere to go next. */
  protected readonly links = computed(() =>
    this.site
      .menu('main')
      .filter((l: MenuLink) => !l.isButton && l.href && l.href !== '#')
      .slice(0, 6),
  );

  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    // Before the first navigation finishes, this page came painted by the server: no entrance, only the loops.
    const fromServer = !this.router.navigated;
    afterNextRender(() => {
      if (motionAllowed(this.site)) void this.animate(fromServer);
    });
  }

  protected back() {
    if (history.length > 1) this.location.back();
    else void this.router.navigateByUrl(this.site.localize('/'));
  }

  private async animate(fromServer: boolean) {
    const node = this.host.nativeElement;
    const splashCovering = () => !!document.querySelector('.splash:not(.splash--leaving)');
    const covered = splashCovering();
    let anime: Anime;
    try {
      anime = await loadAnime();
    } catch {
      return;
    }
    if (this.destroyed) return;
    const $ = <T extends Element = HTMLElement>(sel: string) => [...node.querySelectorAll<T>(sel)];

    this.ambient(anime, $);
    this.draggable(anime, $);
    this.playful.set(true);

    // Entrance: after moving here inside the site, or while the welcome screen still hides the page.
    if (fromServer && !(covered && splashCovering())) return;
    const tl = this.entrance(anime, node, $);
    if (covered) {
      await new Promise<void>((done) => window.addEventListener('splash-leave', () => done(), { once: true }));
      if (!this.destroyed) setTimeout(() => tl.play(), 150);
    } else {
      tl.play();
    }
  }

  /** The loops that keep the scene alive: the aeroplane circling, the compass searching, digits bobbing, dots twinkling. */
  private ambient(anime: Anime, $: <T extends Element = HTMLElement>(sel: string) => T[]) {
    const [route] = $<SVGPathElement>('.nf__route');
    const [plane] = $<SVGGElement>('.nf__plane');
    plane.removeAttribute('transform');
    const flight = anime.animate(plane, { ...anime.createMotionPath(route), duration: 11000, ease: 'linear', loop: true });
    const route$ = anime.animate(route, { strokeDashoffset: [0, -22], duration: 1400, ease: 'linear', loop: true });

    // Swings one way, overshoots, doubles back… then a full turn, so the loop joins up seamlessly.
    const needle = anime.animate($('.nf__needle'), {
      rotate: [
        { to: 35, duration: 0 },
        { to: 140, duration: 900 },
        { to: 95, duration: 700 },
        { to: 250, duration: 1100 },
        { to: 205, duration: 600 },
        { to: 395, duration: 1400 },
      ],
      ease: 'inOut(3)',
      loop: true,
      loopDelay: 500,
    });

    const bob = anime.animate($('.nf__float'), {
      translateY: ['-6px', '6px'],
      duration: 2200,
      ease: 'inOut(2)',
      alternate: true,
      loop: true,
      delay: anime.stagger(350),
    });

    const sparks = anime.animate($('.nf__spark'), {
      scale: [0.4, 1.4],
      opacity: [0.15, 0.8],
      duration: () => 900 + Math.random() * 900,
      delay: anime.stagger(260, { from: 'random' }),
      ease: 'inOut(2)',
      alternate: true,
      loop: true,
    });

    this.cleanups.push(() => [flight, route$, needle, bob, sparks].forEach((a) => a.revert()));
  }

  /** Each digit can be pulled a little way and springs back to its place when let go. */
  private draggable(anime: Anime, $: <T extends Element = HTMLElement>(sel: string) => T[]) {
    for (const el of $('.nf__drag')) {
      const d = anime.createDraggable(el, {
        container: [0, 0, 0, 0],
        containerFriction: 0.55,
        releaseStiffness: 180,
        releaseDamping: 9,
        onGrab: () => anime.animate(el, { scale: 1.08, duration: 200, ease: 'out(3)' }),
        onRelease: () => anime.animate(el, { scale: 1, duration: 500, ease: 'outElastic(1, .5)' }),
      });
      this.cleanups.push(() => d.revert());
    }
  }

  /** Digits drop in on a spring, the compass ring draws itself, then the wording rises letter by letter. */
  private entrance(anime: Anime, node: HTMLElement, $: <T extends Element = HTMLElement>(sel: string) => T[]) {
    const title = $('.nf__title')[0];
    const original = [...title.childNodes];
    const split = anime.splitText(title, { chars: true, words: true });
    const chars = split.chars as HTMLElement[];
    const [ring] = anime.createDrawable($<SVGEllipseElement>('.nf__ring'));
    const rest = $('.nf__eyebrow, .nf__text, .nf__buttons, .nf__more-title, .nf__link, .nf__hint');
    const slots = $('.nf__slot');
    const zero = $('.nf__zero')[0];

    anime.set(slots, { opacity: 0, translateY: '-140px', rotate: anime.stagger(18, { start: -18 }) });
    anime.set(chars, { opacity: 0, translateY: '0.6em', rotate: '8deg' });
    anime.set(rest, { opacity: 0, translateY: '18px' });
    anime.set(ring, { draw: '0 0' });
    anime.set(zero, { rotate: -90 });

    const tl = anime.createTimeline({
      autoplay: false,
      defaults: { ease: 'out(3)' },
      onComplete: () => finish(),
    });
    // Back to no inline styles, so hover effects and the loops above work as before.
    const finish = () => {
      for (const el of [...slots, ...rest, zero]) {
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
        if (!el.getAttribute('style')) el.removeAttribute('style');
      }
      split.revert();
      title.replaceChildren(...original);
    };
    this.cleanups.push(() => {
      tl.pause();
      finish();
    });

    tl.add(slots, {
      opacity: [{ to: 1, duration: 250, ease: 'linear' }],
      translateY: { to: '0px', ease: anime.spring({ stiffness: 140, damping: 11 }) },
      rotate: { to: 0, duration: 900, ease: 'outElastic(1, .6)' },
      delay: anime.stagger(140),
    })
      .add(ring, { draw: ['0 0', '0 1'], duration: 900, ease: 'inOut(3)' }, 280)
      .add(zero, { rotate: 0, duration: 1100, ease: 'outElastic(1, .7)' }, 280)
      .add(rest[0], { opacity: 1, translateY: '0px', duration: 500 }, 500)
      .add(chars, { opacity: 1, translateY: '0em', rotate: '0deg', duration: 700, delay: anime.stagger(22) }, 600)
      .add(rest.slice(1), { opacity: 1, translateY: '0px', duration: 600, delay: anime.stagger(70) }, '<<+=300');
    return tl;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

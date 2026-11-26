import { isPlatformBrowser } from '@angular/common';
import { Component, DOCUMENT, ElementRef, PLATFORM_ID, afterNextRender, inject, signal, type OnDestroy } from '@angular/core';
import { Router, type ActivatedRouteSnapshot } from '@angular/router';
import { SiteStore } from '../core/site';
import { loadAnime, motionAllowed } from '../shared/motion';

type Anime = typeof import('../shared/anime');

/**
 * True when the route being shown is the "can't reach the server" page (the API is not running, restarting or offline).
 * Like the 404 page, the public layout then leaves out the header, banners and footer, which would be empty anyway
 * because the site settings come from the same server.
 */
export function isUnavailableRoute(route: ActivatedRouteSnapshot): boolean {
  let leaf = route;
  while (leaf.firstChild) leaf = leaf.firstChild;
  return (leaf.data['result'] as { kind?: string } | undefined)?.kind === 'unavailable';
}

/** Twinkling dots around the scene: x, y and size in the scene's coordinates (same sky as the 404 page). */
const SPARKS: [number, number, number][] = [
  [70, 60, 3], [560, 48, 2.5], [600, 230, 3], [40, 240, 2], [470, 18, 2], [150, 286, 2.5], [330, 8, 2],
];

/** Seconds between automatic checks: quick at first, then calmer, so a restarting server is picked up fast. */
const RETRY_STEPS = [5, 10, 15, 30];

/** Where the page asks whether the server is back (the same call every public page makes first). */
const HEALTH_URL = '/api/v1/public/site';

/**
 * "We can't reach the server": the sibling of the 404 page, for when the API is not ready.
 * A big 503 whose zero is a plug trying to reach its socket (it keeps trying, with a little spark each time),
 * a data packet circling the scene looking for a way in, and signal waves searching above.
 * Everything moves with Anime.js, the same way as the 404 page: the digits drop in on a spring, the ring draws itself,
 * the heading rises letter by letter, and the digits can be pulled about.
 * The page also checks by itself whether the server is back (with a countdown bar) and reloads as soon as it is,
 * so visitors don't have to keep pressing reload. The server sends the still page (with HTTP 503);
 * movement is added in the browser only, and not at all when the device asks for less motion or animations are off.
 */
@Component({
  selector: 'app-server-unavailable',
  template: `
    <section class="su container" role="alert">
      <div class="su__scene" aria-hidden="true">
        <svg class="su__sky" viewBox="0 0 640 300" focusable="false">
          <path
            class="su__route"
            d="M320,30 C540,30 640,120 580,200 C520,285 120,285 60,200 C0,120 100,30 320,30 Z"
          />
          @for (s of sparks; track $index) {
            <circle class="su__spark" [attr.cx]="s[0]" [attr.cy]="s[1]" [attr.r]="s[2]" />
          }
          <g class="su__packet" transform="translate(320 30)">
            <rect class="su__packet-body" x="-11" y="-8" width="22" height="16" rx="3" />
            <path class="su__packet-flap" d="M-11,-6 L0,2 L11,-6" />
          </g>
        </svg>

        <div class="su__digits">
          <span class="su__slot"><span class="su__float"><span class="su__drag su__digit">5</span></span></span>
          <span class="su__slot">
            <span class="su__float">
              <span class="su__drag su__zero">
                <svg viewBox="0 0 100 140" focusable="false">
                  <g class="su__waves">
                    <path class="su__wave" d="M38,-6 Q50,-14 62,-6" />
                    <path class="su__wave" d="M31,-14 Q50,-27 69,-14" />
                    <path class="su__wave" d="M24,-22 Q50,-40 76,-22" />
                  </g>
                  <ellipse class="su__ring" cx="50" cy="70" rx="38" ry="56" />
                  <ellipse class="su__ring-inner" cx="50" cy="70" rx="25" ry="40" />
                  <!-- Socket at the top, plug (with its cable) underneath, reaching up and never quite making it. -->
                  <g class="su__socket">
                    <rect x="36" y="38" width="28" height="18" rx="5" />
                    <path d="M45,44 V50 M55,44 V50" />
                  </g>
                  <circle class="su__zap" cx="50" cy="63" r="7" />
                  <g class="su__plug">
                    <path class="su__prongs" d="M45,68 V60 M55,68 V60" />
                    <rect class="su__plug-body" x="38" y="68" width="24" height="16" rx="4" />
                    <path class="su__cable" d="M50,84 C50,94 40,96 42,104 C44,110 56,108 54,114" />
                  </g>
                </svg>
              </span>
            </span>
          </span>
          <span class="su__slot"><span class="su__float"><span class="su__drag su__digit">3</span></span></span>
        </div>
      </div>

      <div class="su__copy">
        <p class="su__eyebrow eyebrow">{{ site.t('error.unavailable_eyebrow', 'Error 503 · Server unavailable') }}</p>
        <h1 class="su__title">{{ site.t('error.unavailable_title', 'We can’t reach the server right now') }}</h1>
        <p class="su__text">
          {{ site.t('error.unavailable', 'The website could not connect to its server. It may be starting up, restarting or temporarily offline. Please wait a moment and reload the page.') }}
        </p>
        <div class="su__buttons button-row">
          <button type="button" class="btn btn--primary btn--lg" (click)="reload()" [disabled]="checking()">
            {{ site.t('error.reload', 'Reload page') }}
          </button>
        </div>

        @if (auto()) {
          <div class="su__retry">
            <p class="su__status" aria-live="polite">
              @switch (state()) {
                @case ('checking') { {{ site.t('error.retry_checking', 'Checking whether the server is back…') }} }
                @case ('back') { {{ site.t('error.retry_back', 'The server is back. Loading the page…') }} }
                @default { {{ site.t('error.retry_wait', 'Trying again automatically in {seconds}s', { seconds: countdown() }) }} }
              }
            </p>
            <div class="su__bar" aria-hidden="true"><span class="su__bar-fill"></span></div>
          </div>
        }

        @if (playful()) {
          <p class="su__hint">{{ site.t('error.drag_hint', 'Psst: you can grab the numbers.') }}</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; overflow: hidden; }
    .su { padding-block: clamp(2rem, 6vw, 4.5rem) var(--section-space); text-align: center; }

    /* Scene: the data packet's route surrounds the digits (the same sky as the 404 page). */
    .su__scene { position: relative; width: min(640px, 100%); margin: 0 auto; aspect-ratio: 640 / 300; }
    .su__sky { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .su__route { fill: none; stroke: var(--primary); stroke-opacity: 0.18; stroke-width: 2; stroke-dasharray: 2 9; stroke-linecap: round; }
    .su__spark { fill: var(--accent); opacity: 0.55; transform-box: fill-box; transform-origin: center; }
    .su__packet { transform-box: view-box; transform-origin: 0 0; }
    .su__packet-body { fill: #fff; stroke: var(--primary); stroke-width: 2; }
    .su__packet-flap { fill: none; stroke: var(--primary); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }

    .su__digits {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center; gap: clamp(0.25rem, 2vw, 1rem);
    }
    .su__slot, .su__float, .su__drag { display: block; }
    .su__drag { touch-action: none; user-select: none; -webkit-user-select: none; }
    .su__digit {
      font-size: clamp(6rem, 24vw, 11.5rem); font-weight: 800; line-height: 1; letter-spacing: -0.04em;
      color: var(--primary);
      text-shadow: 0 0.06em 0 var(--primary-deep), 0 0.14em 0.3em color-mix(in srgb, var(--primary-deep) 18%, transparent);
    }
    .su__zero svg { display: block; height: clamp(6.2rem, 25vw, 12rem); width: auto; overflow: visible; filter: drop-shadow(0 0.6rem 1rem color-mix(in srgb, var(--primary-deep) 18%, transparent)); }
    .su__ring { fill: #fff; stroke: var(--primary); stroke-width: 13; }
    .su__ring-inner { fill: none; stroke: var(--primary); stroke-opacity: 0.15; stroke-width: 1.5; }
    .su__waves { opacity: 0.9; }
    .su__wave { fill: none; stroke: var(--accent); stroke-width: 4; stroke-linecap: round; opacity: 0.25; }
    .su__socket rect { fill: var(--surface-2); stroke: var(--primary); stroke-width: 2.5; }
    .su__socket path { stroke: var(--primary-deep); stroke-width: 3; stroke-linecap: round; }
    .su__zap { fill: var(--accent); opacity: 0; transform-box: fill-box; transform-origin: center; }
    .su__plug { transform-box: view-box; }
    .su__prongs { stroke: var(--primary-deep); stroke-width: 3; stroke-linecap: round; }
    .su__plug-body { fill: var(--accent); }
    .su__cable { fill: none; stroke: var(--primary); stroke-width: 3; stroke-linecap: round; }

    .su__copy { max-width: 38rem; margin: clamp(1rem, 3vw, 2rem) auto 0; }
    .su__eyebrow { margin-bottom: 0.5rem; }
    .su__title { margin: 0 0 0.75rem; }
    .su__text { margin: 0 auto 1.75rem; color: var(--muted); font-size: 1.125rem; max-width: 46ch; }
    .su__buttons { justify-content: center; }

    .su__retry { margin: 2.25rem auto 0; padding-top: 1.5rem; border-top: 1px solid var(--line); max-width: 24rem; }
    .su__status { margin: 0 0 0.75rem; color: var(--muted); font-size: 0.95rem; font-weight: 600; }
    .su__bar { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
    .su__bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--accent); transform-origin: left center; transform: scaleX(0); }
    .su__hint { margin: 1.75rem 0 0; color: var(--muted); font-size: 0.85rem; }
  `,
})
export class ServerUnavailable implements OnDestroy {
  protected readonly site = inject(SiteStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly sparks = SPARKS;
  /** Shown once the digits can actually be dragged. */
  protected readonly playful = signal(false);
  /** The automatic "is the server back?" check runs (browser only). */
  protected readonly auto = signal(false);
  protected readonly state = signal<'waiting' | 'checking' | 'back'>('waiting');
  protected readonly countdown = signal(RETRY_STEPS[0]);
  protected readonly checking = signal(false);

  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;
  private attempt = 0;
  private tick: ReturnType<typeof setInterval> | null = null;
  private anime: Anime | null = null;
  private barAnimation: { revert(): unknown } | null = null;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    // Before the first navigation finishes, this page came painted by the server: no entrance, only the loops.
    const fromServer = !this.router.navigated;
    afterNextRender(() => {
      this.auto.set(true);
      this.startCountdown();
      if (motionAllowed(this.site)) void this.animate(fromServer);
    });
  }

  /** Checks the server straight away; reloads when it answers. */
  protected reload() {
    void this.check();
  }

  // ---- Automatic retry ------------------------------------------------------------------------

  private startCountdown() {
    const seconds = RETRY_STEPS[Math.min(this.attempt, RETRY_STEPS.length - 1)];
    this.state.set('waiting');
    this.countdown.set(seconds);
    this.playBar(seconds);
    this.stopTick();
    this.tick = setInterval(() => {
      const left = this.countdown() - 1;
      if (left > 0) this.countdown.set(left);
      else void this.check();
    }, 1000);
  }

  private stopTick() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private async check() {
    if (this.destroyed || this.checking()) return;
    this.stopTick();
    this.checking.set(true);
    this.state.set('checking');
    const back = await serverIsBack();
    if (this.destroyed) return;
    this.checking.set(false);
    if (back) {
      this.state.set('back');
      this.document.location.reload();
      return;
    }
    this.attempt++;
    this.shake();
    this.startCountdown();
  }

  /** The bar under the countdown fills up as the next check approaches. */
  private playBar(seconds: number) {
    const fill = this.host.nativeElement.querySelector<HTMLElement>('.su__bar-fill');
    if (!fill) return;
    this.barAnimation?.revert();
    this.barAnimation = null;
    if (this.anime) {
      this.barAnimation = this.anime.animate(fill, { scaleX: [0, 1], duration: seconds * 1000, ease: 'linear' });
    } else {
      // No movement wanted (or Anime.js not loaded yet): show the bar filled, so nothing moves.
      fill.style.transform = 'scaleX(1)';
    }
  }

  /** A little "no" shake of the zero after a check that found the server still away. */
  private shake() {
    if (!this.anime) return;
    const zero = this.host.nativeElement.querySelector('.su__zero');
    if (zero) this.anime.animate(zero, { translateX: [0, -8, 8, -5, 5, 0], duration: 500, ease: 'inOut(2)' });
  }

  // ---- Animation (Anime.js) -------------------------------------------------------------------

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
    this.anime = anime;
    const $ = <T extends Element = HTMLElement>(sel: string) => [...node.querySelectorAll<T>(sel)];

    this.ambient(anime, $);
    this.draggable(anime, $);
    this.playful.set(true);
    if (this.state() === 'waiting') this.playBar(this.countdown());

    if (fromServer && !(covered && splashCovering())) return;
    const tl = this.entrance(anime, $);
    if (covered) {
      await new Promise<void>((done) => window.addEventListener('splash-leave', () => done(), { once: true }));
      if (!this.destroyed) setTimeout(() => tl.play(), 150);
    } else {
      tl.play();
    }
  }

  /** The loops: the packet circling, the plug trying to connect, signal waves searching, digits bobbing, dots twinkling. */
  private ambient(anime: Anime, $: <T extends Element = HTMLElement>(sel: string) => T[]) {
    const [route] = $<SVGPathElement>('.su__route');
    const [packet] = $<SVGGElement>('.su__packet');
    packet.removeAttribute('transform');
    const travel = anime.animate(packet, { ...anime.createMotionPath(route), duration: 9000, ease: 'inOut(2)', loop: true });
    const route$ = anime.animate(route, { strokeDashoffset: [0, -22], duration: 1400, ease: 'linear', loop: true });

    // The plug reaches up for the socket, a spark flashes in the gap, and it drops back down: never quite connecting.
    const plug = anime.createTimeline({ loop: true, loopDelay: 700 });
    plug
      .add($('.su__plug'), { translateY: [{ to: -3, duration: 700, ease: 'inOut(3)' }, { to: 0, duration: 900, ease: 'outElastic(1, .45)' }] })
      .add($('.su__zap'), { opacity: [0, 1, 0], scale: [0.3, 1.6], duration: 420, ease: 'out(2)' }, 560)
      .add($('.su__socket'), { translateX: [0, -1.5, 1.5, -1, 0], duration: 360, ease: 'linear' }, 600);

    // Signal waves light up from the inside out, like a phone looking for a network.
    const waves = anime.animate($('.su__wave'), {
      opacity: [0.15, 1, 0.15],
      duration: 1500,
      delay: anime.stagger(220),
      ease: 'inOut(2)',
      loop: true,
    });

    const bob = anime.animate($('.su__float'), {
      translateY: ['-6px', '6px'],
      duration: 2200,
      ease: 'inOut(2)',
      alternate: true,
      loop: true,
      delay: anime.stagger(350),
    });

    const sparks = anime.animate($('.su__spark'), {
      scale: [0.4, 1.4],
      opacity: [0.15, 0.8],
      duration: () => 900 + Math.random() * 900,
      delay: anime.stagger(260, { from: 'random' }),
      ease: 'inOut(2)',
      alternate: true,
      loop: true,
    });

    this.cleanups.push(() => [travel, route$, plug, waves, bob, sparks].forEach((a) => a.revert()));
  }

  /** Each digit can be pulled a little way and springs back to its place when let go (as on the 404 page). */
  private draggable(anime: Anime, $: <T extends Element = HTMLElement>(sel: string) => T[]) {
    for (const el of $('.su__drag')) {
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

  /** Digits drop in on a spring, the ring draws itself, then the wording rises letter by letter. */
  private entrance(anime: Anime, $: <T extends Element = HTMLElement>(sel: string) => T[]) {
    const title = $('.su__title')[0];
    const original = [...title.childNodes];
    const split = anime.splitText(title, { chars: true, words: true });
    const chars = split.chars as HTMLElement[];
    const [ring] = anime.createDrawable($<SVGEllipseElement>('.su__ring'));
    const rest = $('.su__eyebrow, .su__text, .su__buttons, .su__retry, .su__hint');
    const slots = $('.su__slot');
    const zero = $('.su__zero')[0];

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
    // Back to no inline styles, so the loops and the "no" shake work as before.
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
    this.stopTick();
    this.barAnimation?.revert();
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

/**
 * True when the API answers again. Any real answer from the API counts (it replies with JSON, even for errors);
 * "no connection" and a proxy's own 5xx page (no JSON) mean it is still away, matching isApiUnreachable().
 */
async function serverIsBack(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (res.ok) return true;
    if (![500, 502, 503, 504].includes(res.status)) return true;
    const body = await res.json().catch(() => null);
    return !!body && typeof body === 'object' && (body as { code?: string }).code !== 'API_UNREACHABLE';
  } catch {
    return false;
  }
}

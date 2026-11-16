import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  type OnDestroy,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { MaintenanceStore } from '../core/maintenance';
import { SiteStore } from '../core/site';
import { loadAnime, motionAllowed } from '../shared/motion';

type Anime = typeof import('../shared/anime');

/** Twinkling dots around the scene: x, y and size in the scene's coordinates. */
const SPARKS: [number, number, number][] = [
  [80, 70, 3], [565, 60, 2.5], [590, 235, 3], [55, 225, 2], [455, 20, 2], [170, 275, 2.5], [215, 25, 2],
];

/** A gear as an SVG path: `teeth` square-ish teeth between an outer and inner radius, centred on 0,0. */
function gear(outer: number, inner: number, teeth: number): string {
  const step = (Math.PI * 2) / teeth;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [r, t] of [[inner, 0], [outer, 0.12], [outer, 0.42], [inner, 0.54]] as const) {
      const ang = a + t * step;
      pts.push(`${(Math.cos(ang) * r).toFixed(2)},${(Math.sin(ang) * r).toFixed(2)}`);
    }
  }
  return `M${pts.join(' L')} Z`;
}

/** The ring's circle as a path (starting at the top, clockwise), so a dot can travel along it. */
const RING = 'M320,30 A120,120 0 1 1 319.99,30 Z';

interface Unit {
  key: string;
  label: string;
  digits: string[];
}

/**
 * "We'll be back soon": shown instead of the site while maintenance mode is on (or a backup is being
 * restored). Laid out like the "page not found" page. A live countdown runs on an Anime.js timer
 * (createTimer); each digit rolls in on a spring as it changes, two gears turn, a ring fills up as the
 * expected end approaches with a dot travelling round it, and the heading rises letter by letter.
 * The server sends a still page (HTTP 503); movement is added in the browser only, and not at all when
 * the visitor's device asks for less motion or the admin has switched animations off. The countdown
 * itself always runs. The page checks every 20 seconds and reloads once the site is back.
 */
@Component({
  selector: 'app-maintenance-page',
  template: `
    <section class="mt container">
      <div class="mt__scene" aria-hidden="true">
        <svg class="mt__sky" viewBox="0 0 640 300" focusable="false">
          @for (s of sparks; track $index) {
            <circle class="mt__spark" [attr.cx]="s[0]" [attr.cy]="s[1]" [attr.r]="s[2]" />
          }
          <path class="mt__track" [attr.d]="ring" />
          <path class="mt__bar" [attr.d]="ring" pathLength="100" [style.stroke-dashoffset]="100 - progress()" />
          <circle class="mt__runner" r="6" transform="translate(320 30)" />
          <g class="mt__gears">
            <g transform="translate(290 162)"><path class="mt__gear mt__gear--big" [attr.d]="bigGear" /><circle class="mt__hub" r="15" /></g>
            <g transform="translate(366 104)"><path class="mt__gear mt__gear--small" [attr.d]="smallGear" /><circle class="mt__hub" r="9" /></g>
          </g>
        </svg>
      </div>

      <div class="mt__copy">
        <p class="mt__eyebrow eyebrow">{{ site.t('maintenance.eyebrow', 'Scheduled maintenance') }}</p>
        <h1 class="mt__title">{{ title() }}</h1>
        <p class="mt__text">{{ message() }}</p>

        @if (endsAt()) {
          <p class="mt__label">{{ site.t('maintenance.back_in', "We'll be back in") }}</p>
          <div class="mt__count" role="timer" [attr.aria-label]="spoken()">
            @for (u of units(); track u.key) {
              <div class="mt__unit">
                <div class="mt__digits">
                  @for (d of u.digits; track $index) {
                    <span class="mt__digit" [attr.data-k]="u.key + $index">{{ d }}</span>
                  }
                </div>
                <span class="mt__unit-label">{{ u.label }}</span>
              </div>
            }
          </div>
          @if (remaining() > 0) {
            <p class="mt__when">{{ site.t('maintenance.back_at', 'Expected back {time}', { time: backAt() }) }}</p>
          } @else {
            <p class="mt__when mt__when--due">{{ site.t('maintenance.almost', 'Almost done. This page will refresh by itself as soon as the site is back.') }}</p>
          }
        } @else {
          <p class="mt__when">{{ site.t('maintenance.no_time', 'This page will refresh by itself as soon as the site is back.') }}</p>
        }

        @if (contact()) {
          <p class="mt__contact">{{ contact() }}</p>
        }
      </div>
    </section>
  `,
  styles: `
    :host { display: block; overflow: hidden; min-height: 100vh; min-height: 100dvh; background: radial-gradient(90% 60% at 50% 0%, var(--primary-soft, #eef3ff), transparent); }
    .mt { padding-block: clamp(2rem, 6vw, 4rem) var(--section-space); text-align: center; }

    .mt__scene { position: relative; width: min(640px, 100%); margin: 0 auto; aspect-ratio: 640 / 300; }
    .mt__sky { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .mt__spark { fill: var(--accent); opacity: 0.55; transform-box: fill-box; transform-origin: center; }
    .mt__track { fill: none; stroke: var(--primary); stroke-opacity: 0.12; stroke-width: 14; }
    .mt__bar { fill: none; stroke: var(--accent); stroke-width: 14; stroke-linecap: round; stroke-dasharray: 100 100; transition: stroke-dashoffset 0.8s ease; }
    .mt__runner { fill: #fff; stroke: var(--primary); stroke-width: 3; }
    .mt__gear { stroke-linejoin: round; transform-box: fill-box; transform-origin: center; }
    .mt__gear--big { fill: var(--primary); }
    .mt__gear--small { fill: var(--accent); }
    .mt__hub { fill: #fff; }

    .mt__copy { max-width: 40rem; margin: clamp(0.5rem, 2vw, 1.25rem) auto 0; }
    .mt__eyebrow { margin-bottom: 0.5rem; }
    .mt__title { margin: 0 0 0.75rem; }
    .mt__text { margin: 0 auto 1.75rem; color: var(--muted); font-size: 1.125rem; max-width: 48ch; }

    .mt__label { margin: 0 0 0.75rem; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.85rem; }
    .mt__count { display: flex; justify-content: center; flex-wrap: wrap; gap: clamp(0.5rem, 2vw, 1rem); perspective: 600px; }
    .mt__unit { display: grid; gap: 0.4rem; justify-items: center; }
    .mt__digits {
      display: flex; gap: 0.15rem; padding: 0.55rem 0.7rem; border-radius: var(--radius);
      background: var(--primary); color: #fff; box-shadow: 0 0.5rem 1.2rem rgb(0 26 92 / 0.22);
      overflow: hidden;
    }
    .mt__digit {
      display: inline-block; width: 0.62em; text-align: center;
      font-size: clamp(2.2rem, 8vw, 3.6rem); font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums;
    }
    .mt__unit-label { color: var(--muted); font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
    .mt__when { margin: 1.25rem 0 0; color: var(--text); font-weight: 600; }
    .mt__when--due { color: var(--accent-text); }
    .mt__contact { margin: 2rem 0 0; padding-top: 1.5rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.95rem; }
  `,
})
export class MaintenancePage implements OnDestroy {
  protected readonly site = inject(SiteStore);
  private readonly store = inject(MaintenanceStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly preview = inject(ActivatedRoute).snapshot.queryParamMap.has('maintenance-preview');

  protected readonly sparks = SPARKS;
  protected readonly ring = RING;
  protected readonly bigGear = gear(58, 46, 12);
  protected readonly smallGear = gear(36, 27, 8);

  /** Milliseconds now, moved on by the timer. */
  private readonly now = signal(Date.now());
  private readonly status = this.store.status;

  protected readonly title = computed(() => {
    const s = this.status();
    if (s?.restoring) return this.site.t('maintenance.restoring', 'The site is being restored');
    return s?.title || this.site.t('maintenance.title', "We're making the site better");
  });
  protected readonly message = computed(
    () => this.status()?.message || this.site.t('maintenance.message', "We're carrying out planned updates. Thank you for your patience. Please check back soon."),
  );
  protected readonly endsAt = computed(() => {
    const at = this.status()?.endsAt;
    return at ? Date.parse(at) : null;
  });
  protected readonly remaining = computed(() => Math.max(0, (this.endsAt() ?? 0) - this.now()));

  protected readonly units = computed<Unit[]>(() => {
    const total = Math.floor(this.remaining() / 1000);
    const days = Math.floor(total / 86400);
    const pad = (n: number) => String(n).padStart(2, '0').split('');
    const units: Unit[] = [];
    if (days > 0) units.push({ key: 'd', label: this.site.t('maintenance.days', 'Days'), digits: pad(days) });
    units.push(
      { key: 'h', label: this.site.t('maintenance.hours', 'Hours'), digits: pad(Math.floor((total % 86400) / 3600)) },
      { key: 'm', label: this.site.t('maintenance.minutes', 'Minutes'), digits: pad(Math.floor((total % 3600) / 60)) },
      { key: 's', label: this.site.t('maintenance.seconds', 'Seconds'), digits: pad(total % 60) },
    );
    return units;
  });

  /** For screen readers: "2 Hours 5 Minutes" (seconds left out, so it is not read out every second). */
  protected readonly spoken = computed(() =>
    this.units()
      .filter((u) => u.key !== 's')
      .map((u) => `${Number(u.digits.join(''))} ${u.label}`)
      .join(' '),
  );

  /** How far through the maintenance we are, 0 to 100, for the ring. Full when no end time is given. */
  protected readonly progress = computed(() => {
    const end = this.endsAt();
    const start = this.status()?.startedAt ? Date.parse(this.status()!.startedAt!) : null;
    if (!end || !start || end <= start) return end ? 100 : 30;
    return Math.round(Math.min(100, Math.max(2, ((this.now() - start) / (end - start)) * 100)));
  });

  protected readonly backAt = computed(() => {
    const end = this.endsAt();
    if (!end) return '';
    const d = new Date(end);
    const sameDay = d.toDateString() === new Date(this.now()).toDateString();
    return d.toLocaleString(this.site.locale(), {
      ...(sameDay ? {} : { weekday: 'long', day: 'numeric', month: 'long' }),
      hour: '2-digit',
      minute: '2-digit',
    });
  });

  protected readonly contact = computed(() => {
    const phone = this.site.setting<string>('contact.phone');
    const email = this.site.setting<string>('contact.email');
    if (!phone || !email) return '';
    return this.site.t('maintenance.contact', 'Need help urgently? Call {phone} or email {email}.', { phone, email });
  });

  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;
  private lastSecond = -1;

  constructor() {
    // The browser tab: "We're making the site better | <institution>" (also on the server-rendered page).
    const name = this.site.institutionName();
    inject(Title).setTitle(name ? `${this.title()} | ${name}` : this.title());
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => void this.start());
  }

  private async start() {
    let anime: Anime | null = null;
    try {
      anime = await loadAnime();
    } catch {
      /* no Anime.js: a plain interval keeps the countdown going */
    }
    if (this.destroyed) return;
    const moving = !!anime && motionAllowed(this.site);

    // The countdown: an Anime.js timer that loops every second (the timer from the Anime.js docs).
    if (anime) {
      const timer = anime.createTimer({ duration: 1000, loop: true, onLoop: () => this.tick(anime, moving) });
      this.cleanups.push(() => timer.revert());
    } else {
      const id = setInterval(() => this.tick(null, false), 1000);
      this.cleanups.push(() => clearInterval(id));
    }
    this.tick(anime, false);

    // Every 20 seconds: back to the site as soon as maintenance is over (not when only previewing).
    const poll = setInterval(() => void this.check(), 20_000);
    this.cleanups.push(() => clearInterval(poll));

    if (moving) {
      this.ambient(anime!);
      this.entrance(anime!);
    }
  }

  private async check() {
    if (this.preview) return;
    const s = await this.store.refresh();
    if (s && (!s.active || s.bypass)) location.reload();
  }

  /** Once a second: move the clock on, and roll in any digit that changed. */
  private tick(anime: Anime | null, moving: boolean) {
    const second = Math.floor(Date.now() / 1000);
    if (second === this.lastSecond) return;
    const before = this.digitMap();
    this.lastSecond = second;
    this.now.set(Date.now());
    if (this.endsAt() && this.remaining() === 0 && before.size) void this.check();
    if (!moving || !anime) return;
    // After Angular has written the new digits.
    requestAnimationFrame(() => {
      const after = this.digitMap();
      const changed = [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => this.el(`[data-k="${k}"]`)).filter(Boolean);
      if (!changed.length) return;
      anime.animate(changed as HTMLElement[], {
        // Well under a second, so the seconds digit always lands before the next one rolls in.
        translateY: { from: '-70%', to: '0%', duration: 450, ease: 'outBack(1.7)' },
        rotateX: { from: -80, to: 0, duration: 450, ease: 'out(3)' },
        opacity: { from: 0, to: 1, duration: 200, ease: 'linear' },
        delay: anime.stagger(40),
      });
      const runner = this.el('.mt__gear--small');
      if (runner) anime.animate(runner, { scale: [1.12, 1], duration: 400, ease: 'out(3)' });
    });
  }

  private digitMap() {
    return new Map(this.units().flatMap((u) => u.digits.map((d, i) => [`${u.key}${i}`, d] as const)));
  }

  private el(selector: string) {
    return this.host.nativeElement.querySelector<HTMLElement | SVGElement>(selector);
  }

  /** Loops: the gears turn against each other, a dot travels round the ring, sparks twinkle, the scene floats. */
  private ambient(anime: Anime) {
    const $ = (s: string) => [...this.host.nativeElement.querySelectorAll<HTMLElement>(s)];
    const big = anime.animate($('.mt__gear--big'), { rotate: 360, duration: 9000, ease: 'linear', loop: true });
    // 12 teeth against 8: the small gear turns 1.5 times as fast, the other way.
    const small = anime.animate($('.mt__gear--small'), { rotate: -540, duration: 9000, ease: 'linear', loop: true });
    const [track] = $('.mt__track') as unknown as SVGPathElement[];
    // The motion path positions it from 0,0, so the starting offset comes off first.
    $('.mt__runner').forEach((r) => r.removeAttribute('transform'));
    const runner = anime.animate($('.mt__runner'), { ...anime.createMotionPath(track), duration: 7000, ease: 'linear', loop: true });
    const sparks = anime.animate($('.mt__spark'), {
      scale: [0.4, 1.4],
      opacity: [0.15, 0.8],
      duration: () => 900 + Math.random() * 900,
      delay: anime.stagger(260, { from: 'random' }),
      ease: 'inOut(2)',
      alternate: true,
      loop: true,
    });
    const float = anime.animate($('.mt__gears'), { translateY: [-5, 5], duration: 2400, ease: 'inOut(2)', alternate: true, loop: true });
    this.cleanups.push(() => [big, small, runner, sparks, float].forEach((a) => a.revert()));
  }

  /** The ring draws itself, the gears spring in, the heading rises letter by letter, the countdown flips in. */
  private entrance(anime: Anime) {
    const node = this.host.nativeElement;
    const $ = (s: string) => [...node.querySelectorAll<HTMLElement>(s)];
    const title = $('.mt__title')[0];
    const original = [...title.childNodes];
    const split = anime.splitText(title, { chars: true, words: true });
    const chars = split.chars as HTMLElement[];
    const [track] = anime.createDrawable($('.mt__track') as unknown as SVGPathElement[]);
    const gearsEls = $('.mt__gear');
    const rest = $('.mt__eyebrow, .mt__text, .mt__label, .mt__when, .mt__contact');
    const cards = $('.mt__unit');

    anime.set(track, { draw: '0 0' });
    anime.set(gearsEls, { scale: 0 });
    anime.set(chars, { opacity: 0, translateY: '0.6em', rotate: '8deg' });
    anime.set(rest, { opacity: 0, translateY: '16px' });
    anime.set(cards, { opacity: 0, rotateX: -90 });

    const finish = () => {
      for (const el of [...rest, ...cards]) {
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
        if (!el.getAttribute('style')) el.removeAttribute('style');
      }
      split.revert();
      title.replaceChildren(...original);
    };
    const tl = anime.createTimeline({ defaults: { ease: 'out(3)' }, onComplete: finish });
    this.cleanups.push(() => {
      tl.pause();
      finish();
    });
    tl.add(track, { draw: ['0 0', '0 1'], duration: 1100, ease: 'inOut(3)' })
      .add(gearsEls, { scale: [0, 1], ease: anime.spring({ stiffness: 160, damping: 10 }), delay: anime.stagger(150) }, 200)
      .add(rest[0], { opacity: 1, translateY: '0px', duration: 500 }, 300)
      .add(chars, { opacity: 1, translateY: '0em', rotate: '0deg', duration: 700, delay: anime.stagger(20) }, 400)
      .add(rest.slice(1, 3), { opacity: 1, translateY: '0px', duration: 600, delay: anime.stagger(80) }, '<<+=250')
      .add(cards, { opacity: 1, rotateX: 0, duration: 800, ease: 'outElastic(1, .7)', delay: anime.stagger(110) }, '<<+=150')
      .add(rest.slice(3), { opacity: 1, translateY: '0px', duration: 600, delay: anime.stagger(80) }, '<<+=300');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

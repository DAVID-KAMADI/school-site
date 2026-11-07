import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
  type OnDestroy,
} from '@angular/core';
import type { MediaView } from '../../core/models';
import { MediaImage } from '../media-image';

const INTERVAL_MS = 6500;

export type HeroMode = 'video' | 'slideshow';

/**
 * Hero background: a muted looping video, a photo slideshow (crossfade with a slow "Ken Burns" zoom), or both
 * with a Video / Photos switch so visitors can change between them at any time.
 * Pauses on hover, keyboard focus or the pause button (WCAG 2.2.2), and stays still for reduced-motion users.
 */
@Component({
  selector: 'app-hero-slideshow',
  imports: [MediaImage],
  host: {
    '(mouseenter)': 'hover.set(true)',
    '(mouseleave)': 'hover.set(false)',
    '[class.hero-bg--video]': "mode() === 'video'",
  },
  template: `
    <div class="slides" [class.slides--still]="!animate()" [class.slides--hidden]="mode() === 'video'">
      @for (s of slides(); track s.id; let i = $index) {
        <div class="slide" [class.slide--active]="i === current()" [attr.aria-hidden]="i !== current()">
          <!-- Only the first photo loads with the page; the rest follow once it has finished, to save mobile data. -->
          @if (i === 0 || loadRest()) {
            <app-media-image [media]="s" sizes="100vw" [eager]="i === 0" [decorative]="true" />
          }
        </div>
      }
    </div>
    @if (video(); as v) {
      <!-- Loaded only after the page has finished (or when a visitor switches to it), so it never delays the first paint. -->
      <video
        #vid
        class="bg-video"
        [class.bg-video--on]="mode() === 'video'"
        [muted]="true"
        loop
        playsinline
        preload="none"
        aria-hidden="true"
        [attr.poster]="poster()"
        [attr.src]="loadVideo() ? v.url : null"
      ></video>
    }
    @if (showControls()) {
      <div class="controls">
        @if (video() && slides().length) {
          <div class="switch" role="group" aria-label="Background">
            <button type="button" [class.on]="mode() === 'video'" [attr.aria-pressed]="mode() === 'video'" (click)="setMode('video')">Video</button>
            <button type="button" [class.on]="mode() === 'slideshow'" [attr.aria-pressed]="mode() === 'slideshow'" (click)="setMode('slideshow')">Photos</button>
          </div>
        }
        <button type="button" class="ctl" (click)="toggle()" [attr.aria-label]="(paused() ? 'Play ' : 'Pause ') + (mode() === 'video' ? 'video' : 'slideshow')">
          {{ paused() ? '▶' : '❚❚' }}
        </button>
        @if (mode() === 'slideshow' && slides().length > 1) {
          @for (s of slides(); track s.id; let i = $index) {
            <button type="button" class="dot" [class.dot--active]="i === current()" (click)="go(i)" [attr.aria-label]="'Show photo ' + (i + 1)" [attr.aria-current]="i === current()"></button>
          }
        }
      </div>
    }
  `,
  styles: `
    :host { position: absolute; inset: 0; display: block; }
    .slides, .slide { position: absolute; inset: 0; overflow: hidden; }
    .slides { transition: opacity 0.9s ease; }
    .slides--hidden { opacity: 0; }
    .slide { opacity: 0; transition: opacity 1.4s ease; }
    .slide--active { opacity: 1; }
    .slide app-media-image { height: 100%; transform-origin: 60% 40%; }
    .slide--active app-media-image { animation: kenburns 9s ease-out forwards; }
    .slides--still .slide app-media-image { animation: none; }
    @keyframes kenburns { from { transform: scale(1.12); } to { transform: scale(1); } }
    .bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.9s ease; pointer-events: none; }
    .bg-video--on { opacity: 1; }
    .controls { position: absolute; z-index: 3; right: var(--gutter); bottom: 1.5rem; display: flex; gap: 0.5rem; align-items: center; }
    .switch { display: flex; padding: 3px; border-radius: 999px; border: 1px solid rgb(255 255 255 / 0.6); background: rgb(0 26 92 / 0.35); backdrop-filter: blur(6px); margin-right: 0.25rem; }
    .switch button { min-height: 1.9rem; padding: 0 0.85rem; border: 0; border-radius: 999px; background: none; color: #fff; font: inherit; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: background 0.25s ease, color 0.25s ease; }
    .switch button.on { background: #fff; color: var(--primary); }
    .switch button:not(.on):hover { background: rgb(255 255 255 / 0.2); }
    .ctl { width: 2.25rem; height: 2.25rem; border-radius: 50%; border: 1px solid rgb(255 255 255 / 0.6); background: rgb(0 26 92 / 0.35); color: #fff; font-size: 0.7rem; cursor: pointer; }
    /* 24px tap area (WCAG 2.5.8) around a small visual dot. */
    .dot { position: relative; width: 1.5rem; height: 1.5rem; padding: 0; border: 0; background: none; cursor: pointer; transition: width 0.3s ease; }
    .dot::before { content: ''; position: absolute; left: 50%; top: 50%; translate: -50% -50%; width: 0.65rem; height: 0.65rem; border-radius: 999px; background: rgb(255 255 255 / 0.55); transition: width 0.3s ease, background 0.3s ease; }
    .dot--active { width: 2.4rem; }
    .dot--active::before { width: 1.9rem; background: var(--accent); }
    .dot:hover::before { background: rgb(255 255 255 / 0.9); }
    .ctl:hover { background-color: rgb(255 255 255 / 0.85); }
    .ctl:hover { color: var(--primary); }
  `,
})
export class HeroSlideshow implements OnDestroy {
  readonly slides = input<MediaView[]>([]);
  readonly video = input<MediaView | null>(null);
  /** Which background shows first when both are set. */
  readonly startWith = input<HeroMode>('video');

  protected readonly mode = linkedSignal<HeroMode>(() =>
    this.video() && (this.startWith() === 'video' || !this.slides().length) ? 'video' : 'slideshow',
  );
  protected readonly current = signal(0);
  protected readonly paused = signal(false);
  protected readonly hover = signal(false);
  protected readonly animate = signal(true);
  protected readonly loadRest = signal(false);
  protected readonly loadVideo = signal(false);
  private readonly pageLoaded = signal(false);
  private readonly vid = viewChild<ElementRef<HTMLVideoElement>>('vid');
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly showControls = computed(() => !!this.video() || this.slides().length > 1);

  /** The main photo stands in for the video until it has loaded. */
  protected readonly poster = computed(() => {
    const s = this.slides()[0];
    if (!s) return null;
    const fits = s.srcset.filter((v) => v.width <= 1920).sort((a, b) => b.width - a.width);
    return fits[0]?.url ?? s.url;
  });

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    afterNextRender(() => {
      const onLoad = () => {
        this.pageLoaded.set(true);
        setTimeout(() => this.loadRest.set(true), 2500);
      };
      if (document.readyState === 'complete') onLoad();
      else window.addEventListener('load', onLoad, { once: true });
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.animate.set(false);
        this.paused.set(true);
        return;
      }
      this.timer = setInterval(() => {
        const focused = document.activeElement?.closest('.hero') !== null && document.activeElement !== document.body;
        if (this.mode() === 'slideshow' && !this.paused() && !this.hover() && !focused && !document.hidden) this.next();
      }, INTERVAL_MS);
    });

    // Start downloading the video once the page has loaded, if it is the one on show.
    effect(() => {
      if (this.pageLoaded() && this.mode() === 'video' && this.video()) this.loadVideo.set(true);
    });

    // Play the video only while it is on show and not paused. Runs after rendering, so the src is already set.
    afterRenderEffect(() => {
      const el = this.vid()?.nativeElement;
      if (!el || !this.loadVideo()) return;
      el.muted = true;
      if (this.mode() === 'video' && !this.paused()) {
        // If the browser refuses autoplay (e.g. data saver), show the play button instead of a stuck video.
        el.play().catch((e: DOMException) => e.name === 'NotAllowedError' && this.paused.set(true));
      } else el.pause();
    });
  }

  setMode(m: HeroMode) {
    this.mode.set(m);
    if (m === 'video') this.loadVideo.set(true);
    else this.loadRest.set(true);
  }

  next() {
    if (!this.loadRest()) return;
    this.current.update((i) => (i + 1) % this.slides().length);
  }

  go(i: number) {
    this.loadRest.set(true);
    this.current.set(i);
  }

  toggle() {
    this.paused.update((p) => !p);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

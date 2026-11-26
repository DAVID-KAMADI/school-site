import { DatePipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
  type OnDestroy,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { MediaView } from '../../core/models';
import type { GalleryAlbumView } from '../../core/showcase';
import { SiteStore } from '../../core/site';
import { MediaImage } from '../../shared/media-image';
import { loadAnime, motionAllowed } from '../../shared/motion';
import { clearStyles, stage, type Anime } from '../showcase-motion';
import type { Loaded } from '../showcase-resolvers';
import { AlbumCardView } from './album-card';

/** Seconds each photo stays up during a slideshow. */
const SLIDE_SECONDS = 5;

/**
 * One album (/gallery/<slug>): its photos in a masonry wall that settles into place as it scrolls in,
 * and a full-screen viewer. The photo grows out of the one that was tapped, visitors swipe or use the
 * arrow keys and the strip of thumbnails, and a slideshow can play with a progress line.
 */
@Component({
  selector: 'app-album-page',
  imports: [RouterLink, DatePipe, MediaImage, AlbumCardView],
  template: `
    @if (result().data; as d) {
      <header class="a-head" #head>
        <div class="container">
          <a class="a-back" routerLink="/gallery"><span aria-hidden="true">←</span> All albums</a>
          @if (d.album.category) {
            <p class="a-eyebrow">{{ d.album.category }}</p>
          }
          <h1 class="a-title" #title>{{ d.album.title }}</h1>
          <p class="a-meta">
            @if (d.album.takenOn) {
              <time [attr.datetime]="d.album.takenOn">{{
                d.album.takenOn | date: 'd MMMM y'
              }}</time>
              <span aria-hidden="true">·</span>
            }
            <span>{{ d.photos.length }} {{ d.photos.length === 1 ? 'photo' : 'photos' }}</span>
          </p>
          @if (d.album.description) {
            <p class="a-desc">{{ d.album.description }}</p>
          }
          @if (d.photos.length > 1) {
            <button type="button" class="btn btn--primary a-play" (click)="open(0, $event, true)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg> Play
              slideshow
            </button>
          }
        </div>
      </header>

      <section class="container a-wall-wrap">
        <ul class="a-wall" #wall>
          @for (p of d.photos; track $index; let i = $index) {
            <li>
              <button
                type="button"
                class="a-thumb"
                [style.aspect-ratio]="ratio(d.media[p.mediaId])"
                (click)="open(i, $event)"
                [attr.aria-label]="
                  'Open photo ' +
                  (i + 1) +
                  ' of ' +
                  d.photos.length +
                  (captionOf(i) ? ': ' + captionOf(i) : '')
                "
              >
                <app-media-image
                  [media]="d.media[p.mediaId]"
                  sizes="(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 25vw"
                />
              </button>
            </li>
          }
        </ul>
      </section>

      @if (d.more.length) {
        <section class="a-more">
          <div class="container">
            <h2 class="a-more__title">More albums</h2>
            <ul class="a-more__grid">
              @for (a of d.more; track a.id) {
                <li><app-album-card [album]="a" /></li>
              }
            </ul>
          </div>
        </section>
      }

      @if (current() !== null) {
        <div
          class="viewer"
          #viewer
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="d.album.title + ' photos'"
          tabindex="-1"
          (keydown)="onKey($event)"
        >
          <div class="viewer__top">
            <span class="viewer__count" aria-live="polite"
              >{{ current()! + 1 }} / {{ d.photos.length }}</span
            >
            <div class="viewer__tools">
              @if (d.photos.length > 1) {
                <button
                  type="button"
                  class="viewer__btn"
                  (click)="togglePlay()"
                  [attr.aria-label]="playing() ? 'Pause slideshow' : 'Play slideshow'"
                >
                  @if (playing()) {
                    <svg class="solid" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                    </svg>
                  } @else {
                    <svg class="solid" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  }
                </button>
              }
              <button type="button" class="viewer__btn" (click)="close()" aria-label="Close">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </div>
          <span class="viewer__progress" #progress aria-hidden="true"></span>

          <div class="viewer__stage" (click)="close()">
            <figure
              #figure
              (click)="$event.stopPropagation()"
              (pointerdown)="swipeStart($event)"
              (pointermove)="swipeMove($event)"
              (pointerup)="swipeEnd()"
              (pointercancel)="swipeEnd()"
            >
              <app-media-image
                class="viewer__photo"
                [media]="activeMedia()"
                sizes="95vw"
                [eager]="true"
              />
              @if (captionOf(current()!)) {
                <figcaption>{{ captionOf(current()!) }}</figcaption>
              }
            </figure>
            @if (d.photos.length > 1) {
              <button
                type="button"
                class="viewer__btn viewer__nav viewer__nav--prev"
                (click)="move(-1, $event)"
                aria-label="Previous photo"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
              <button
                type="button"
                class="viewer__btn viewer__nav viewer__nav--next"
                (click)="move(1, $event)"
                aria-label="Next photo"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            }
          </div>

          @if (d.photos.length > 1) {
            <div class="viewer__strip" #strip>
              @for (p of d.photos; track $index; let i = $index) {
                <button
                  type="button"
                  class="viewer__mini"
                  [class.viewer__mini--on]="i === current()"
                  (click)="go(i)"
                  [attr.aria-label]="'Show photo ' + (i + 1)"
                  [attr.aria-current]="i === current() ? 'true' : null"
                >
                  <app-media-image [media]="d.media[p.mediaId]" [decorative]="true" sizes="5rem" />
                </button>
              }
            </div>
          }
        </div>
      }
    } @else {
      <section class="container a-missing">
        @if (result().error === 'not-found') {
          <h1>Album not found</h1>
          <p>It may have been moved or taken down.</p>
        } @else {
          <h1>Gallery unavailable</h1>
          <p>The gallery is temporarily unavailable. Please try again shortly.</p>
        }
        <a class="btn btn--primary" routerLink="/gallery">See all albums</a>
      </section>
    }
  `,
  styleUrl: './album-page.scss',
})
export class AlbumPage implements OnDestroy {
  readonly result = input.required<Loaded<GalleryAlbumView>>();

  protected readonly current = signal<number | null>(null);
  protected readonly playing = signal(false);
  protected readonly activeMedia = computed(() => {
    const d = this.result().data;
    const i = this.current();
    return d && i !== null ? d.media[d.photos[i].mediaId] : null;
  });

  private readonly site = inject(SiteStore);
  private readonly document = inject(DOCUMENT);
  private readonly head = viewChild<ElementRef<HTMLElement>>('head');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly wall = viewChild<ElementRef<HTMLElement>>('wall');
  private readonly viewer = viewChild<ElementRef<HTMLElement>>('viewer');
  private readonly figure = viewChild<ElementRef<HTMLElement>>('figure');
  private readonly progress = viewChild<ElementRef<HTMLElement>>('progress');
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');

  private anime: Anime | null = null;
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;
  private returnFocus: HTMLElement | null = null;
  private swipe: { id: number; x: number; y: number; dx: number } | null = null;
  private slideTimer: ReturnType<Anime['animate']> | null = null;

  constructor() {
    const title = inject(Title);
    effect(() => {
      const d = this.result().data;
      title.setTitle(d ? `${d.album.title} | Gallery` : 'Gallery');
    });
    // The thumbnail strip keeps the current photo in view.
    effect(() => {
      const i = this.current();
      const strip = this.strip()?.nativeElement;
      const mini = strip?.children[i ?? -1] as HTMLElement | undefined;
      if (strip && mini)
        strip.scrollTo({
          left: mini.offsetLeft - (strip.clientWidth - mini.offsetWidth) / 2,
          behavior: 'smooth',
        });
    });
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const fromServer = !inject(Router).navigated;
    afterNextRender(() => void this.enter(fromServer));
  }

  protected ratio(m: MediaView | undefined) {
    return m?.width && m.height ? `${m.width} / ${m.height}` : '4 / 3';
  }

  protected captionOf(i: number) {
    const d = this.result().data;
    if (!d) return '';
    const p = d.photos[i];
    return p.caption || d.media[p.mediaId]?.caption || '';
  }

  // ---------- Entrance ----------

  private async enter(fromServer: boolean) {
    if (!motionAllowed(this.site)) return;
    try {
      this.anime = await loadAnime();
    } catch {
      return;
    }
    if (this.destroyed) return;
    const anime = this.anime;
    const head = this.head()?.nativeElement;
    const title = this.title()?.nativeElement;
    if (head && title) {
      const parts = [
        ...head.querySelectorAll<HTMLElement>('.a-back, .a-eyebrow, .a-meta, .a-desc, .a-play'),
      ];
      const original = [...title.childNodes];
      let words: HTMLElement[] = [];
      let split: ReturnType<Anime['splitText']> | null = null;
      this.cleanups.push(
        stage(
          anime,
          head,
          fromServer,
          () => {
            split = anime.splitText(title, { words: true });
            words = split.words as HTMLElement[];
            anime.set(words, { opacity: 0, translateY: '0.5em' });
            anime.set(parts, { opacity: 0, translateY: '14px' });
          },
          () => {
            const tl = anime.createTimeline({
              defaults: { ease: 'out(3)' },
              onComplete: () => {
                split?.revert();
                title.replaceChildren(...original);
                clearStyles(parts);
              },
            });
            tl.add(
              words,
              { opacity: 1, translateY: '0em', duration: 800, delay: anime.stagger(60) },
              100,
            ).add(
              parts,
              { opacity: 1, translateY: '0px', duration: 600, delay: anime.stagger(70) },
              0,
            );
          },
        ),
      );
    }
    this.wallEntrance(anime, fromServer);
  }

  /** Photos settle onto the wall a few at a time as each comes into view, with a slight tilt that straightens. */
  private wallEntrance(anime: Anime, fromServer: boolean) {
    const wall = this.wall()?.nativeElement;
    if (!wall || typeof IntersectionObserver === 'undefined') return;
    const firstScreen = wall.getBoundingClientRect().top < window.innerHeight * 0.9;
    let thumbs = [...wall.querySelectorAll<HTMLElement>('.a-thumb')];
    // A page the server already painted keeps its first screen still.
    if (fromServer && firstScreen)
      thumbs = thumbs.filter((t) => t.getBoundingClientRect().top > window.innerHeight);
    if (!thumbs.length) return;
    anime.set(thumbs, {
      opacity: 0,
      translateY: '40px',
      scale: 0.92,
      rotate: () => `${Math.round(Math.random() * 8 - 4)}deg`,
    });
    let batch: HTMLElement[] = [];
    let frame = 0;
    const flush = () => {
      const now = batch.splice(0);
      frame = 0;
      anime.animate(now, {
        opacity: 1,
        translateY: '0px',
        scale: 1,
        rotate: '0deg',
        duration: 900,
        ease: anime.spring({ bounce: 0.25, duration: 650 }),
        delay: anime.stagger(70),
        onComplete: () => clearStyles(now),
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          observer.unobserve(e.target);
          batch.push(e.target as HTMLElement);
        }
        if (batch.length && !frame) frame = requestAnimationFrame(flush);
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    thumbs.forEach((t) => observer.observe(t));
    this.cleanups.push(() => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      clearStyles(thumbs);
    });
  }

  // ---------- Viewer ----------

  open(index: number, event: Event, play = false) {
    this.returnFocus = event.currentTarget as HTMLElement;
    const thumb = play ? null : this.returnFocus;
    this.current.set(index);
    this.document.body.style.overflow = 'hidden';
    setTimeout(() => {
      this.viewer()?.nativeElement.focus();
      void this.growFrom(thumb);
      if (play) this.togglePlay();
    });
  }

  close() {
    this.stopSlideshow();
    this.current.set(null);
    this.document.body.style.removeProperty('overflow');
    this.returnFocus?.focus();
  }

  move(step: number, event?: Event) {
    event?.stopPropagation();
    const n = this.result().data?.photos.length ?? 0;
    if (!n) return;
    this.current.update((i) => ((i ?? 0) + step + n) % n);
    void this.slideIn(step);
    if (this.playing()) this.runSlideTimer();
  }

  go(index: number) {
    const from = this.current() ?? 0;
    if (index === from) return;
    this.current.set(index);
    void this.slideIn(index > from ? 1 : -1);
    if (this.playing()) this.runSlideTimer();
  }

  togglePlay() {
    if (this.playing()) this.stopSlideshow();
    else {
      this.playing.set(true);
      this.runSlideTimer();
    }
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.move(1);
    else if (e.key === 'ArrowLeft') this.move(-1);
    else if (e.key === ' ' && (e.target as HTMLElement) === this.viewer()?.nativeElement) {
      e.preventDefault();
      this.togglePlay();
    } else if (e.key === 'Tab') this.trapFocus(e);
  }

  /** The progress line under the top bar fills over SLIDE_SECONDS, then the next photo comes in. */
  private runSlideTimer() {
    this.slideTimer?.cancel();
    const bar = this.progress()?.nativeElement;
    const next = () => this.playing() && this.move(1);
    if (!bar || !this.anime) {
      // No animations: still move on every few seconds.
      const t = setTimeout(next, SLIDE_SECONDS * 1000);
      this.slideTimer = { cancel: () => clearTimeout(t) } as ReturnType<Anime['animate']>;
      return;
    }
    this.slideTimer = this.anime.animate(bar, {
      scaleX: [0, 1],
      duration: SLIDE_SECONDS * 1000,
      ease: 'linear',
      onComplete: next,
    });
  }

  private stopSlideshow() {
    this.playing.set(false);
    this.slideTimer?.cancel();
    this.slideTimer = null;
    const bar = this.progress()?.nativeElement;
    if (bar) bar.style.removeProperty('transform');
  }

  /** Starts the photo at the size and place of its thumbnail, then lets it grow to full size. */
  private async growFrom(thumb: HTMLElement | null) {
    const photo = this.figure()?.nativeElement.querySelector<HTMLElement>('.viewer__photo');
    if (!photo || !motionAllowed(this.site)) return;
    const anime = this.anime ?? (await loadAnime().catch(() => null));
    if (!anime) return;
    this.anime = anime;
    const to = photo.getBoundingClientRect();
    if (!thumb || !to.width || !to.height) {
      anime.animate(photo, {
        opacity: [0, 1],
        scale: [0.94, 1],
        duration: 500,
        ease: 'out(3)',
        onComplete: () => clearStyles([photo]),
      });
      return;
    }
    const from = thumb.getBoundingClientRect();
    anime.animate(photo, {
      translateX: [`${from.left + from.width / 2 - (to.left + to.width / 2)}px`, '0px'],
      translateY: [`${from.top + from.height / 2 - (to.top + to.height / 2)}px`, '0px'],
      scale: [Math.min(from.width / to.width, from.height / to.height), 1],
      duration: 550,
      ease: 'out(4)',
      onComplete: () => clearStyles([photo]),
    });
  }

  /** The new photo slides in from the side it came from. */
  private async slideIn(step: number) {
    const fig = this.figure()?.nativeElement;
    if (!fig || !motionAllowed(this.site) || !this.anime) return;
    this.anime.animate(fig, {
      translateX: [`${step * 60}px`, '0px'],
      opacity: [0, 1],
      duration: 420,
      ease: 'out(3)',
      onComplete: () => clearStyles([fig]),
    });
  }

  protected swipeStart(e: PointerEvent) {
    if (e.pointerType === 'mouse' || (this.result().data?.photos.length ?? 0) < 2) return;
    this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
  }

  protected swipeMove(e: PointerEvent) {
    const s = this.swipe;
    const fig = this.figure()?.nativeElement;
    if (!s || s.id !== e.pointerId || !fig) return;
    const dx = e.clientX - s.x;
    if (Math.abs(e.clientY - s.y) > Math.abs(dx)) return;
    s.dx = dx;
    fig.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    fig.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600));
  }

  protected swipeEnd() {
    const s = this.swipe;
    const fig = this.figure()?.nativeElement;
    this.swipe = null;
    if (!s || !fig || !s.dx) return;
    if (Math.abs(s.dx) > 60) {
      clearStyles([fig]);
      this.move(s.dx < 0 ? 1 : -1);
    } else if (this.anime && motionAllowed(this.site)) {
      this.anime.animate(fig, {
        translateX: '0px',
        rotate: '0deg',
        opacity: 1,
        duration: 500,
        ease: this.anime.spring({ bounce: 0.4, duration: 400 }),
        onComplete: () => clearStyles([fig]),
      });
    } else {
      clearStyles([fig]);
    }
  }

  /** Keeps keyboard focus inside the viewer while it is open. */
  private trapFocus(e: KeyboardEvent) {
    const box = this.viewer()?.nativeElement;
    if (!box) return;
    const focusable = [...box.querySelectorAll<HTMLElement>('button')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.document.activeElement;
    if (e.shiftKey && (active === first || active === box)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.slideTimer?.cancel();
    if (this.current() !== null) this.document.body.style.removeProperty('overflow');
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

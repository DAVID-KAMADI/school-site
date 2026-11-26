import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectorRef,
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
import { Router } from '@angular/router';
import { SiteStore } from '../../core/site';
import type { AlbumCard, GalleryIndex } from '../../core/showcase';
import { MediaImage } from '../../shared/media-image';
import { AlbumCardView } from './album-card';
import { loadAnime, motionAllowed } from '../../shared/motion';
import { clearStyles, stage, type Anime, type Drawable } from '../showcase-motion';
import type { Loaded } from '../showcase-resolvers';

/** Where each photo of the hero's photo pile lies once fanned out. */
const FAN = [
  { x: '-34%', y: '6%', r: '-11deg' },
  { x: '30%', y: '-4%', r: '9deg' },
  { x: '-8%', y: '-10%', r: '-3deg' },
  { x: '6%', y: '8%', r: '4deg' },
];

/**
 * The Gallery page (/gallery): photo albums made in Admin → Gallery.
 * A pile of printed photos fans out in the header (and can be pushed around), the category chips slide a
 * highlight between them, and filtering re-flows the album grid with Anime.js layout animations.
 */
@Component({
  selector: 'app-gallery-page',
  imports: [MediaImage, AlbumCardView],
  template: `
    @if (result().data; as d) {
      <section class="g-hero" #hero>
        <div class="g-hero__grain" aria-hidden="true"></div>
        <div class="container g-hero__inner">
          <div class="g-hero__text">
            @if (d.page.eyebrow) {
              <p class="g-eyebrow" #eyebrow>{{ d.page.eyebrow }}</p>
            }
            <h1 class="g-title" #title>{{ d.page.title }}</h1>
            @if (d.page.intro) {
              <p class="g-intro" #intro>{{ d.page.intro }}</p>
            }
            @if (d.albums.length) {
              <dl class="g-tally" #tally>
                <div>
                  <dt>Albums</dt>
                  <dd>{{ d.albums.length }}</dd>
                </div>
                <div>
                  <dt>Photos</dt>
                  <dd>{{ photoTotal() }}</dd>
                </div>
                @if (d.categories.length) {
                  <div>
                    <dt>Topics</dt>
                    <dd>{{ d.categories.length }}</dd>
                  </div>
                }
              </dl>
            }
          </div>
          @if (pile().length) {
            <div class="g-pile" #pileEl aria-hidden="true">
              @for (a of pile(); track a.id; let i = $index) {
                <div
                  class="g-pile__slot"
                  [style.--x]="fan[i].x"
                  [style.--y]="fan[i].y"
                  [style.--r]="fan[i].r"
                  [style.z-index]="i + 1"
                >
                  <div class="g-pile__photo">
                    <app-media-image
                      [media]="a.cover"
                      [decorative]="true"
                      sizes="20rem"
                      [eager]="i === pile().length - 1"
                    />
                  </div>
                </div>
              }
            </div>
          }
        </div>
        <svg
          class="g-hero__curve"
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path #curve d="M0 52 C 240 8, 480 8, 720 40 S 1200 76, 1440 24" />
        </svg>
      </section>

      <section class="container g-body">
        @if (d.albums.length) {
          @if (d.categories.length) {
            <div class="g-filters" #filters role="group" aria-label="Show albums about">
              <span class="g-filters__pill" #pill aria-hidden="true"></span>
              <button
                type="button"
                class="g-chip"
                [class.g-chip--on]="filter() === null"
                [attr.aria-pressed]="filter() === null"
                (click)="choose(null)"
              >
                All <span class="g-chip__count">{{ d.albums.length }}</span>
              </button>
              @for (c of d.categories; track c) {
                <button
                  type="button"
                  class="g-chip"
                  [class.g-chip--on]="filter() === c"
                  [attr.aria-pressed]="filter() === c"
                  (click)="choose(c)"
                >
                  {{ c }} <span class="g-chip__count">{{ countFor(c) }}</span>
                </button>
              }
            </div>
          }
          <p class="visually-hidden" aria-live="polite">{{ shownCount() }} albums shown</p>

          <ul class="g-grid" #grid>
            @for (a of d.albums; track a.id; let i = $index) {
              <li
                class="g-item"
                [class.g-item--featured]="a.isFeatured && i < 3"
                [class.is-hidden]="!shows(a)"
              >
                <app-album-card [album]="a" [featured]="a.isFeatured && i < 3" />
              </li>
            }
          </ul>
        } @else {
          <div class="g-empty">
            <span class="g-empty__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 7h3l2-3h6l2 3h3v13H4z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </span>
            <h2>Photos are on their way</h2>
            <p>Albums from our events and campus life will appear here soon.</p>
          </div>
        }
      </section>
    } @else {
      <section class="container g-body">
        <p class="g-notice" role="alert">
          The gallery is temporarily unavailable. Please try again shortly.
        </p>
      </section>
    }
  `,
  styleUrl: './gallery-page.scss',
})
export class GalleryPage implements OnDestroy {
  readonly result = input.required<Loaded<GalleryIndex>>();

  protected readonly fan = FAN;
  protected readonly filter = signal<string | null>(null);
  protected readonly albums = computed(() => this.result().data?.albums ?? []);
  protected readonly photoTotal = computed(() =>
    this.albums().reduce((n, a) => n + a.photoCount, 0),
  );
  protected readonly shownCount = computed(() => this.albums().filter((a) => this.shows(a)).length);
  /** Up to four album covers for the photo pile in the header, the first album's on top. */
  protected readonly pile = computed(() =>
    this.albums()
      .filter((a) => a.cover)
      .slice(0, 4)
      .reverse(),
  );

  private readonly site = inject(SiteStore);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly hero = viewChild<ElementRef<HTMLElement>>('hero');
  private readonly eyebrow = viewChild<ElementRef<HTMLElement>>('eyebrow');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly intro = viewChild<ElementRef<HTMLElement>>('intro');
  private readonly tally = viewChild<ElementRef<HTMLElement>>('tally');
  private readonly pileEl = viewChild<ElementRef<HTMLElement>>('pileEl');
  private readonly curve = viewChild<ElementRef<SVGPathElement>>('curve');
  private readonly filters = viewChild<ElementRef<HTMLElement>>('filters');
  private readonly pill = viewChild<ElementRef<HTMLElement>>('pill');
  private readonly grid = viewChild<ElementRef<HTMLElement>>('grid');

  private anime: Anime | null = null;
  private layout: ReturnType<Anime['createLayout']> | null = null;
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;

  constructor() {
    const title = inject(Title);
    effect(() => title.setTitle(this.result().data?.page.title ?? 'Gallery'));
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const fromServer = !inject(Router).navigated;
    afterNextRender(() => void this.animate(fromServer));
  }

  protected shows(a: AlbumCard) {
    const f = this.filter();
    return f === null || a.category === f;
  }

  protected countFor(category: string) {
    return this.albums().filter((a) => a.category === category).length;
  }

  /** Shows one category. The albums that stay glide to their new places; the others shrink away. */
  protected choose(category: string | null) {
    if (category === this.filter()) return;
    const apply = () => {
      this.filter.set(category);
      this.cdr.detectChanges();
    };
    if (this.layout) {
      this.layout.update(apply, {
        duration: 650,
        ease: 'out(4)',
        delay: this.anime!.stagger(25),
        enterFrom: { opacity: 0, scale: 0.85 },
        leaveTo: { opacity: 0, scale: 0.85 },
      });
    } else {
      apply();
    }
    this.movePill(true);
  }

  private async animate(fromServer: boolean) {
    // The chip highlight is positioned with or without movement.
    this.filters()?.nativeElement.classList.add('g-filters--live');
    this.movePill(false);
    const onResize = () => this.movePill(false);
    window.addEventListener('resize', onResize);
    this.cleanups.push(() => window.removeEventListener('resize', onResize));

    if (!motionAllowed(this.site)) return;
    let anime: Anime;
    try {
      anime = await loadAnime();
    } catch {
      return;
    }
    if (this.destroyed) return;
    this.anime = anime;

    const grid = this.grid()?.nativeElement;
    if (grid) {
      this.layout = anime.createLayout(grid, { children: '.g-item' });
      this.cleanups.push(() => this.layout?.revert());
    }
    this.pushablePile(anime);
    this.heroEntrance(anime, fromServer);
    this.gridEntrance(anime, fromServer);
  }

  /** The heading rises letter by letter while the photo pile is thrown down and fans out. */
  private heroEntrance(anime: Anime, fromServer: boolean) {
    const hero = this.hero()?.nativeElement;
    const title = this.title()?.nativeElement;
    if (!hero || !title) return;
    const slots = [
      ...(this.pileEl()?.nativeElement.querySelectorAll<HTMLElement>('.g-pile__slot') ?? []),
    ];
    const others = [this.eyebrow(), this.intro(), this.tally()].flatMap((r) =>
      r ? [r.nativeElement] : [],
    );
    const curve = this.curve()?.nativeElement;
    const original = [...title.childNodes];
    let split: ReturnType<Anime['splitText']> | null = null;
    let drawable: Drawable = [];

    const done = stage(
      anime,
      hero,
      fromServer,
      () => {
        split = anime.splitText(title, { chars: true });
        anime.set(split.chars, { opacity: 0, translateY: '0.6em', rotate: '8deg' });
        anime.set(others, { opacity: 0, translateY: '18px' });
        // The stylesheet's hover transition would lag behind every frame of the throw.
        slots.forEach((s) => (s.style.setProperty('--pile', '1'), (s.style.transition = 'none')));
        anime.set(slots, { opacity: 0 });
        if (curve) {
          drawable = anime.createDrawable(curve);
          anime.set(drawable, { draw: '0 0' });
        }
      },
      () => {
        const tl = anime.createTimeline({
          defaults: { ease: 'out(3)' },
          onComplete: () => {
            split?.revert();
            title.replaceChildren(...original);
            clearStyles(others);
            clearStyles(slots, ['opacity', 'transition']);
            slots.forEach((s) => s.style.removeProperty('--pile'));
          },
        });
        if (split)
          tl.add(
            split.chars,
            {
              opacity: 1,
              translateY: '0em',
              rotate: '0deg',
              duration: 700,
              delay: anime.stagger(35),
            },
            0,
          );
        if (others.length)
          tl.add(
            others,
            { opacity: 1, translateY: '0px', duration: 600, delay: anime.stagger(90) },
            250,
          );
        if (slots.length)
          tl.add(
            slots,
            {
              opacity: [0, 1],
              '--pile': [1, 0],
              duration: 900,
              ease: anime.spring({ bounce: 0.35, duration: 700 }),
              delay: anime.stagger(110),
            },
            150,
          );
        if (drawable.length)
          tl.add(drawable, { draw: ['0 0', '0 1'], duration: 1400, ease: 'inOut(3)' }, 300);
      },
    );
    this.cleanups.push(done);
  }

  /** Album cards rise into place in a wave across the grid as it scrolls into view. */
  private gridEntrance(anime: Anime, fromServer: boolean) {
    const grid = this.grid()?.nativeElement;
    if (!grid) return;
    const cards = [...grid.querySelectorAll<HTMLElement>('.g-item:not(.is-hidden) app-album-card')];
    if (!cards.length) return;
    const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
    const done = stage(
      anime,
      grid,
      fromServer,
      () => anime.set(cards, { opacity: 0, translateY: '48px', scale: 0.96 }),
      () =>
        anime.animate(cards, {
          opacity: 1,
          translateY: '0px',
          scale: 1,
          duration: 900,
          ease: 'out(4)',
          delay: anime.stagger(80, { grid: [cols, Math.ceil(cards.length / cols)], from: 'first' }),
          onComplete: () => clearStyles(cards),
        }),
    );
    this.cleanups.push(done);
  }

  /** Visitors can push the photos in the header around; they spring back onto the pile. */
  private pushablePile(anime: Anime) {
    const photos = [
      ...(this.pileEl()?.nativeElement.querySelectorAll<HTMLElement>('.g-pile__photo') ?? []),
    ];
    for (const photo of photos) {
      const drag = anime.createDraggable(photo, {
        x: { snap: [0] },
        y: { snap: [0] },
        releaseStiffness: 160,
        releaseDamping: 12,
        cursor: { onHover: 'grab', onGrab: 'grabbing' },
      });
      this.cleanups.push(() => drag.revert());
    }
  }

  /** Slides the orange highlight behind the chosen category chip. */
  private movePill(animated: boolean) {
    const box = this.filters()?.nativeElement;
    const pill = this.pill()?.nativeElement;
    // Wait a frame so the chosen chip's state has been rendered.
    requestAnimationFrame(() => {
      const on = box?.querySelector<HTMLElement>('.g-chip--on');
      if (!box || !pill || !on) return;
      const to = { left: `${on.offsetLeft}px`, width: `${on.offsetWidth}px` };
      if (animated && this.anime)
        this.anime.animate(pill, {
          ...to,
          duration: 550,
          ease: this.anime.spring({ bounce: 0.3, duration: 450 }),
        });
      else Object.assign(pill.style, to);
      // On a phone the chips scroll sideways: bring the chosen one to the middle (never scrolls the page itself).
      if (animated && box.scrollWidth > box.clientWidth)
        box.scrollTo({
          left: on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2,
          behavior: 'smooth',
        });
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

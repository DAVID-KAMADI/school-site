import { DOCUMENT, isPlatformBrowser } from '@angular/common';
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
  viewChildren,
  type OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import type { StaffHierarchy, StaffPerson, StaffTier } from '../../core/showcase';
import { SiteStore } from '../../core/site';
import { MediaImage } from '../../shared/media-image';
import { loadAnime, motionAllowed } from '../../shared/motion';
import { clearStyles, stage, type Anime, type Drawable } from '../showcase-motion';
import type { Loaded } from '../showcase-resolvers';

const HONORIFICS = /^(dr|prof|mr|mrs|ms|miss|eng|rev|hon|cpa|sr|fr)\.?$/i;

/**
 * The Our people page (/staff): the institute's hierarchy from the top down, made in Admin → Staff hierarchy.
 * Each tier is joined to the one above by a line that draws itself as it scrolls in, the people pop into
 * place from the middle out with a ring drawn around their photo, and a card opens into a full profile.
 */
@Component({
  selector: 'app-staff-page',
  imports: [FormsModule, MediaImage],
  template: `
    @if (result().data; as d) {
      <section class="s-hero" #hero>
        <div class="container s-hero__inner">
          <div>
            @if (d.page.eyebrow) {
              <p class="s-eyebrow">{{ d.page.eyebrow }}</p>
            }
            <h1 class="s-title" #title>{{ d.page.title }}</h1>
            @if (d.page.intro) {
              <p class="s-intro">{{ d.page.intro }}</p>
            }
            @if (total() > 6) {
              <label class="s-search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4-4" />
                </svg>
                <span class="visually-hidden">Find a person by name, role or department</span>
                <input
                  type="search"
                  placeholder="Find someone by name, role or department"
                  [ngModel]="query()"
                  (ngModelChange)="query.set($event)"
                />
              </label>
            }
          </div>
          <svg class="s-tree" #tree viewBox="0 0 240 200" aria-hidden="true">
            <path
              d="M120 34 V78 M50 78 H190 M50 78 V118 M120 78 V118 M190 78 V118 M120 140 V164 M80 164 H160 M80 164 V178 M160 164 V178"
            />
            <circle cx="120" cy="22" r="14" class="s-tree__top" />
            <circle cx="50" cy="128" r="10" />
            <circle cx="120" cy="128" r="10" />
            <circle cx="190" cy="128" r="10" />
            <circle cx="80" cy="186" r="7" />
            <circle cx="160" cy="186" r="7" />
          </svg>
        </div>
      </section>

      <section class="container s-chart">
        <p class="visually-hidden" aria-live="polite">
          {{ query() ? shownCount() + ' people found' : '' }}
        </p>
        @for (tier of tiers(); track tier.id; let t = $index) {
          <section
            #tierEl
            class="s-tier"
            [class.s-tier--lead]="t === 0 && !query()"
            [attr.aria-labelledby]="'tier-' + tier.id"
          >
            @if (t > 0) {
              <svg class="s-link" viewBox="0 0 2 100" preserveAspectRatio="none" aria-hidden="true">
                <path d="M1 0 V100" />
              </svg>
            }
            <header class="s-tier__head">
              <span class="s-tier__dot" aria-hidden="true"></span>
              <h2 class="s-tier__name" [id]="'tier-' + tier.id">{{ tier.name }}</h2>
              @if (tier.description && !query()) {
                <p class="s-tier__desc">{{ tier.description }}</p>
              }
            </header>
            <ul class="s-people" [class.s-people--few]="tier.members.length <= 2">
              @for (p of tier.members; track p.id) {
                <li>
                  <button
                    type="button"
                    class="s-card"
                    (click)="open(p, tier, $event)"
                    [attr.aria-label]="p.name + ', ' + p.position + '. Open profile'"
                  >
                    <span class="s-card__photo">
                      @if (p.photo) {
                        <app-media-image [media]="p.photo" [decorative]="true" sizes="10rem" />
                      } @else {
                        <span class="s-card__initials" aria-hidden="true">{{
                          initials(p.name)
                        }}</span>
                      }
                      <svg class="s-card__ring" viewBox="0 0 100 100" aria-hidden="true">
                        <circle cx="50" cy="50" r="48" />
                      </svg>
                    </span>
                    <span class="s-card__name">{{ p.name }}</span>
                    <span class="s-card__role">{{ p.position }}</span>
                    @if (p.department) {
                      <span class="s-card__dept">{{ p.department }}</span>
                    }
                  </button>
                </li>
              }
            </ul>
          </section>
        } @empty {
          <div class="s-empty">
            @if (query()) {
              <h2>No one matches "{{ query() }}"</h2>
              <p>Try part of a name, a role such as "Lecturer", or a department.</p>
              <button type="button" class="btn btn--outline" (click)="query.set('')">
                Show everyone
              </button>
            } @else {
              <h2>Our team will appear here soon</h2>
              <p>Check back to meet the people behind the institute.</p>
            }
          </div>
        }
      </section>

      @if (selected(); as s) {
        <div class="s-backdrop" (click)="close()">
          <article
            #panel
            class="s-profile"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="s.person.name"
            tabindex="-1"
            (click)="$event.stopPropagation()"
            (keydown)="onKey($event)"
          >
            <button
              type="button"
              class="s-profile__close"
              (click)="close()"
              aria-label="Close profile"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <div class="s-profile__photo">
              @if (s.person.photo) {
                <app-media-image
                  [media]="s.person.photo"
                  [alt]="s.person.name"
                  sizes="20rem"
                  [eager]="true"
                />
              } @else {
                <span class="s-profile__initials" aria-hidden="true">{{
                  initials(s.person.name)
                }}</span>
              }
            </div>
            <div class="s-profile__body">
              <p class="s-profile__tier">{{ s.tier }}</p>
              <h2 class="s-profile__name">{{ s.person.name }}</h2>
              <p class="s-profile__role">
                {{ s.person.position }}
                @if (s.person.department) {
                  · {{ s.person.department }}
                }
              </p>
              @if (s.person.bio) {
                <div class="s-profile__bio">
                  @for (para of paragraphs(s.person.bio); track $index) {
                    <p>{{ para }}</p>
                  }
                </div>
              }
              @if (s.person.email || s.person.phone) {
                <div class="s-profile__contact">
                  @if (s.person.email) {
                    <a class="btn btn--primary" [href]="'mailto:' + s.person.email">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 6h18v12H3z" />
                        <path d="M3 7l9 6 9-6" />
                      </svg>
                      Email
                    </a>
                  }
                  @if (s.person.phone) {
                    <a class="btn btn--outline" [href]="telHref(s.person.phone)">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
                        />
                      </svg>
                      {{ s.person.phone }}
                    </a>
                  }
                </div>
              }
            </div>
          </article>
        </div>
      }
    } @else {
      <section class="container s-chart">
        <p class="s-notice" role="alert">
          This page is temporarily unavailable. Please try again shortly.
        </p>
      </section>
    }
  `,
  styleUrl: './staff-page.scss',
})
export class StaffPage implements OnDestroy {
  readonly result = input.required<Loaded<StaffHierarchy>>();

  protected readonly query = signal('');
  protected readonly selected = signal<{ person: StaffPerson; tier: string } | null>(null);
  protected readonly total = computed(() =>
    (this.result().data?.levels ?? []).reduce((n, l) => n + l.members.length, 0),
  );
  /** The tiers, narrowed to the people who match the search. */
  protected readonly tiers = computed<StaffTier[]>(() => {
    const levels = this.result().data?.levels ?? [];
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return levels;
    return levels
      .map((l) => ({
        ...l,
        members: l.members.filter((m) => {
          const text = [m.name, m.position, m.department ?? '', l.name].join(' ').toLowerCase();
          return words.every((w) => text.includes(w));
        }),
      }))
      .filter((l) => l.members.length);
  });
  protected readonly shownCount = computed(() =>
    this.tiers().reduce((n, l) => n + l.members.length, 0),
  );

  private readonly site = inject(SiteStore);
  private readonly document = inject(DOCUMENT);
  private readonly hero = viewChild<ElementRef<HTMLElement>>('hero');
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly tree = viewChild<ElementRef<SVGSVGElement>>('tree');
  private readonly tierEls = viewChildren<ElementRef<HTMLElement>>('tierEl');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  private anime: Anime | null = null;
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    const title = inject(Title);
    effect(() => title.setTitle(this.result().data?.page.title ?? 'Our people'));
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const fromServer = !inject(Router).navigated;
    afterNextRender(() => void this.enter(fromServer));
  }

  protected initials(name: string) {
    const parts = name.split(/\s+/).filter((w) => w && !HONORIFICS.test(w));
    return (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
    ).toUpperCase();
  }

  protected telHref(phone: string) {
    return 'tel:' + phone.replace(/[^+\d]/g, '');
  }

  protected paragraphs(text: string) {
    return text
      .split(/\n\s*\n|\n/)
      .map((p) => p.trim())
      .filter(Boolean);
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
    this.heroEntrance(this.anime, fromServer);
    for (const tier of this.tierEls())
      this.tierEntrance(this.anime, tier.nativeElement, fromServer);
  }

  /** The heading rises word by word while the little tree diagram draws itself, top down. */
  private heroEntrance(anime: Anime, fromServer: boolean) {
    const hero = this.hero()?.nativeElement;
    const title = this.title()?.nativeElement;
    const tree = this.tree()?.nativeElement;
    if (!hero || !title) return;
    const parts = [...hero.querySelectorAll<HTMLElement>('.s-eyebrow, .s-intro, .s-search')];
    const original = [...title.childNodes];
    const line = tree?.querySelector('path');
    const dots = tree ? [...tree.querySelectorAll('circle')] : [];
    let split: ReturnType<Anime['splitText']> | null = null;
    let drawable: Drawable = [];
    this.cleanups.push(
      stage(
        anime,
        hero,
        fromServer,
        () => {
          split = anime.splitText(title, { words: true });
          anime.set(split.words, { opacity: 0, translateY: '0.5em' });
          anime.set(parts, { opacity: 0, translateY: '16px' });
          if (line) {
            drawable = anime.createDrawable(line);
            anime.set(drawable, { draw: '0 0' });
          }
          anime.set(dots, { scale: 0, transformOrigin: '50% 50%' });
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
          if (split)
            tl.add(
              split.words,
              { opacity: 1, translateY: '0em', duration: 800, delay: anime.stagger(60) },
              100,
            );
          tl.add(
            parts,
            { opacity: 1, translateY: '0px', duration: 600, delay: anime.stagger(80) },
            200,
          );
          if (dots.length)
            tl.add(
              dots[0],
              { scale: 1, duration: 600, ease: anime.spring({ bounce: 0.5, duration: 500 }) },
              250,
            );
          if (drawable.length)
            tl.add(drawable, { draw: ['0 0', '0 1'], duration: 1300, ease: 'inOut(2)' }, 450);
          if (dots.length > 1)
            tl.add(
              dots.slice(1),
              {
                scale: 1,
                duration: 600,
                ease: anime.spring({ bounce: 0.5, duration: 500 }),
                delay: anime.stagger(120),
              },
              900,
            );
        },
      ),
    );
  }

  /** Line from the tier above draws down, the tier's name rises, then its people pop in from the middle out. */
  private tierEntrance(anime: Anime, tier: HTMLElement, fromServer: boolean) {
    const link = tier.querySelector<SVGPathElement>('.s-link path');
    const head = [...tier.querySelectorAll<HTMLElement>('.s-tier__head > *')];
    const cards = [...tier.querySelectorAll<HTMLElement>('.s-card')];
    const rings = [...tier.querySelectorAll<SVGCircleElement>('.s-card__ring circle')];
    let linkDraw: Drawable = [];
    let ringDraw: Drawable = [];
    this.cleanups.push(
      stage(
        anime,
        tier,
        fromServer,
        () => {
          if (link) {
            linkDraw = anime.createDrawable(link);
            anime.set(linkDraw, { draw: '0 0' });
          }
          ringDraw = rings.length ? anime.createDrawable(rings) : [];
          if (ringDraw.length) anime.set(ringDraw, { draw: '0 0' });
          anime.set(head, { opacity: 0, translateY: '14px' });
          anime.set(cards, { opacity: 0, translateY: '30px', scale: 0.85 });
        },
        () => {
          const tl = anime.createTimeline({
            defaults: { ease: 'out(3)' },
            onComplete: () => clearStyles([...head, ...cards]),
          });
          if (linkDraw.length)
            tl.add(linkDraw, { draw: ['0 0', '0 1'], duration: 600, ease: 'inOut(2)' }, 0);
          tl.add(
            head,
            { opacity: 1, translateY: '0px', duration: 550, delay: anime.stagger(70) },
            linkDraw.length ? 350 : 0,
          );
          tl.add(
            cards,
            {
              opacity: 1,
              translateY: '0px',
              scale: 1,
              duration: 800,
              ease: anime.spring({ bounce: 0.3, duration: 600 }),
              delay: anime.stagger(70, { from: 'center' }),
            },
            linkDraw.length ? 550 : 200,
          );
          if (ringDraw.length)
            tl.add(
              ringDraw,
              {
                draw: ['0 0', '0 1'],
                duration: 900,
                ease: 'inOut(3)',
                delay: anime.stagger(70, { from: 'center' }),
              },
              linkDraw.length ? 750 : 400,
            );
        },
      ),
    );
  }

  // ---------- Profile ----------

  open(person: StaffPerson, tier: StaffTier, event: Event) {
    const card = event.currentTarget as HTMLElement;
    this.returnFocus = card;
    this.selected.set({ person, tier: tier.name });
    this.document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const panel = this.panel()?.nativeElement;
      panel?.focus();
      if (panel) void this.growFrom(card, panel);
    });
  }

  close() {
    this.selected.set(null);
    this.document.body.style.removeProperty('overflow');
    this.returnFocus?.focus();
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'Tab') {
      const panel = this.panel()?.nativeElement;
      const focusable = panel ? [...panel.querySelectorAll<HTMLElement>('button, a[href]')] : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = this.document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /** The profile opens out of the card that was clicked, and its parts follow one after another. */
  private async growFrom(card: HTMLElement, panel: HTMLElement) {
    if (!motionAllowed(this.site)) return;
    const anime = this.anime ?? (await loadAnime().catch(() => null));
    if (!anime) return;
    const from = card.getBoundingClientRect();
    const to = panel.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const parts = [
      ...panel.querySelectorAll<HTMLElement>('.s-profile__photo, .s-profile__body > *'),
    ];
    anime.set(parts, { opacity: 0, translateY: '12px' });
    const tl = anime.createTimeline({ onComplete: () => clearStyles([panel, ...parts]) });
    tl.add(
      panel,
      {
        translateX: [`${from.left + from.width / 2 - (to.left + to.width / 2)}px`, '0px'],
        translateY: [`${from.top + from.height / 2 - (to.top + to.height / 2)}px`, '0px'],
        scale: [Math.min(1, from.width / to.width), 1],
        opacity: [0.4, 1],
        duration: 600,
        ease: 'out(4)',
      },
      0,
    ).add(
      parts,
      { opacity: 1, translateY: '0px', duration: 500, ease: 'out(3)', delay: anime.stagger(60) },
      250,
    );
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.selected()) this.document.body.style.removeProperty('overflow');
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

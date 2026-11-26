import { NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
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
  untracked,
  viewChild,
  type OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { DownloadItem, DownloadsIndex } from '../../core/showcase';
import { SiteStore } from '../../core/site';
import { loadAnime, motionAllowed } from '../../shared/motion';
import { clearStyles, stage, type Anime } from '../showcase-motion';
import type { Loaded } from '../showcase-resolvers';

/** Dates and deadlines are shown in the institute's own time zone, whoever is looking. */
const ZONE = 'Africa/Nairobi';
const day = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const time = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: true });

/** File types that browsers can open in a tab, so a "View" button is offered as well. */
const VIEWABLE = new Set(['PDF', 'Image']);

/**
 * The Downloads page (/downloads and /downloads/<category>): tenders, job vacancies, forms and other
 * documents added in Admin → Downloads. Category tabs, a quick search, deadlines that count down,
 * and closed tenders/adverts kept in a folded "Closed" list underneath.
 */
@Component({
  selector: 'app-downloads-page',
  imports: [FormsModule, NgTemplateOutlet, RouterLink],
  template: `
    @if (result().data; as d) {
      <section class="d-hero" #hero>
        <div class="container d-hero__inner">
          <div>
            @if (d.page.eyebrow) {
              <p class="d-eyebrow" data-in>{{ d.page.eyebrow }}</p>
            }
            <h1 class="d-title" data-in>{{ current()?.name ?? d.page.title }}</h1>
            <p class="d-intro" data-in>{{ current()?.description || d.page.intro }}</p>
            @if (openCount()) {
              <p class="d-live" data-in>
                <span class="d-live__dot" aria-hidden="true"></span>
                {{ openCount() }} {{ openCount() === 1 ? 'open call' : 'open calls' }} with a deadline
              </p>
            }
          </div>
          <div class="d-stack" #stackEl aria-hidden="true">
            <span class="d-sheet d-sheet--3"><b>XLSX</b></span>
            <span class="d-sheet d-sheet--2"><b>DOCX</b></span>
            <span class="d-sheet d-sheet--1">
              <b>PDF</b>
              <i></i><i></i><i></i><i class="short"></i>
            </span>
            <span class="d-arrow">
              <svg viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M5 20h14" /></svg>
            </span>
          </div>
        </div>
      </section>

      <section class="container d-body">
        <nav class="d-tabs" aria-label="Document categories">
          <a class="d-tab" routerLink="/downloads" [class.d-tab--on]="!category()" [attr.aria-current]="!category() ? 'page' : null">
            All <span class="d-tab__n">{{ d.items.length }}</span>
          </a>
          @for (c of tabs(); track c.id) {
            <a
              class="d-tab"
              [routerLink]="['/downloads', c.slug]"
              [class.d-tab--on]="category() === c.slug"
              [attr.aria-current]="category() === c.slug ? 'page' : null"
            >
              {{ c.name }} <span class="d-tab__n">{{ c.count }}</span>
            </a>
          }
        </nav>

        @if (category() && !current()) {
          <div class="d-empty">
            <h2>This category does not exist</h2>
            <p>It may have been renamed or removed.</p>
            <a class="btn btn--primary" routerLink="/downloads">See all documents</a>
          </div>
        } @else {
          @if (inView().length > 5) {
            <label class="d-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <span class="visually-hidden">Search documents</span>
              <input type="search" placeholder="Search by title or reference number" [ngModel]="query()" (ngModelChange)="query.set($event)" />
            </label>
          }
          <p class="visually-hidden" aria-live="polite">{{ query() ? shown().length + ' documents found' : '' }}</p>

          @if (open().length) {
            <ul class="d-list" #list>
              @for (doc of open(); track doc.id) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: doc }" />
              }
            </ul>
          } @else if (!closed().length) {
            <div class="d-empty">
              <span class="d-empty__mark" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z M14 3v4h4" /></svg>
              </span>
              @if (query()) {
                <h2>Nothing matches "{{ query() }}"</h2>
                <p>Try another word or part of the reference number.</p>
                <button type="button" class="btn btn--outline" (click)="query.set('')">Clear the search</button>
              } @else {
                <h2>{{ emptyTitle() }}</h2>
                <p>Please check again soon.</p>
              }
            </div>
          } @else {
            <p class="d-none-open">There are no open {{ (current()?.name ?? 'documents').toLowerCase() }} right now. Closed ones are listed below.</p>
          }

          @if (closed().length) {
            <details class="d-closed" [open]="!open().length">
              <summary>
                Closed <span class="d-tab__n">{{ closed().length }}</span>
                <small>Deadlines that have passed, kept for reference</small>
              </summary>
              <ul class="d-list d-list--closed">
                @for (doc of closed(); track doc.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: doc }" />
                }
              </ul>
            </details>
          }
        }
      </section>

      <ng-template #row let-doc>
        <li class="d-doc" [class.d-doc--pinned]="doc.isPinned" [class.d-doc--closed]="doc.isClosed">
          <span class="d-type" [attr.data-type]="doc.file.type" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 2.5h8.5l4 4V21.5H6z M14.5 2.5v4h4" /></svg>
            <b>{{ short(doc.file.type) }}</b>
          </span>
          <div class="d-doc__main">
            <p class="d-doc__over">
              @if (doc.isPinned) {
                <span class="d-pin">Important</span>
              }
              @if (!category()) {
                <span>{{ categoryName(doc.categoryId) }}</span>
              }
              @if (doc.reference) {
                <span class="d-ref">Ref: {{ doc.reference }}</span>
              }
            </p>
            <h3 class="d-doc__title">{{ doc.title }}</h3>
            @if (doc.summary) {
              <p class="d-doc__summary">{{ doc.summary }}</p>
            }
            <p class="d-doc__meta">
              <span>Posted {{ date(doc.publishedOn) }}</span>
              <span>{{ doc.file.type }} · {{ size(doc.file.sizeBytes) }}</span>
            </p>
          </div>
          <div class="d-doc__side">
            @if (doc.closesAt) {
              <span class="d-due" [attr.data-state]="dueState(doc)">
                {{ dueLabel(doc) }}
              </span>
            }
            <div class="d-doc__actions">
              <a class="btn btn--primary d-btn" [href]="doc.file.url" [attr.download]="doc.file.saveAs" [attr.aria-label]="'Download ' + doc.title + ' (' + doc.file.type + ', ' + size(doc.file.sizeBytes) + ')'">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>
                Download
              </a>
              @if (viewable(doc)) {
                <a class="btn btn--outline d-btn" [href]="doc.file.url" target="_blank" rel="noopener" [attr.aria-label]="'View ' + doc.title + ' in a new tab'">View</a>
              }
            </div>
          </div>
        </li>
      </ng-template>
    } @else {
      <section class="container d-body">
        <p class="d-notice" role="alert">Downloads are temporarily unavailable. Please try again shortly.</p>
      </section>
    }
  `,
  styleUrl: './downloads-page.scss',
})
export class DownloadsPage implements OnDestroy {
  readonly result = input.required<Loaded<DownloadsIndex>>();
  /** From the address: /downloads/<category>. */
  readonly category = input<string | undefined>();

  protected readonly query = signal('');
  protected readonly current = computed(() => {
    const slug = this.category();
    return slug ? (this.result().data?.categories.find((c) => c.slug === slug) ?? null) : null;
  });
  /** Tabs for categories that have documents, plus the open one even when it is empty. */
  protected readonly tabs = computed(() =>
    (this.result().data?.categories ?? []).filter((c) => c.count > 0 || c.slug === this.category()),
  );
  protected readonly inView = computed(() => {
    const items = this.result().data?.items ?? [];
    const c = this.current();
    return c ? items.filter((d) => d.categoryId === c.id) : items;
  });
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.inView();
    return this.inView().filter((d) =>
      [d.title, d.reference, d.summary].some((v) => v?.toLowerCase().includes(q)),
    );
  });
  protected readonly open = computed(() => this.shown().filter((d) => !d.isClosed));
  /** Closed ones, latest deadline first. */
  protected readonly closed = computed(() =>
    this.shown()
      .filter((d) => d.isClosed)
      .sort((a, b) => (b.closesAt ?? '').localeCompare(a.closesAt ?? '')),
  );
  protected readonly openCount = computed(() => this.inView().filter((d) => d.closesAt && !d.isClosed).length);
  protected readonly emptyTitle = computed(() => {
    const slug = this.current()?.slug;
    if (slug === 'tenders') return 'No open tenders at the moment';
    if (slug === 'jobs') return 'No vacancies at the moment';
    return 'No documents here yet';
  });

  private readonly site = inject(SiteStore);
  private readonly hero = viewChild<ElementRef<HTMLElement>>('hero');
  private readonly stackEl = viewChild<ElementRef<HTMLElement>>('stackEl');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private anime: Anime | null = null;
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;

  constructor() {
    const title = inject(Title);
    const meta = inject(Meta);
    effect(() => {
      const d = this.result().data;
      const c = this.current();
      const name = c?.name ?? d?.page.title ?? 'Downloads';
      title.setTitle(`${name} | ${this.site.institutionName()}`);
      const text = c?.description || d?.page.intro;
      if (text) meta.updateTag({ name: 'description', content: text });
    });
    // A new category starts with an empty search, and its list slides in.
    effect(() => {
      this.category();
      untracked(() => {
        this.query.set('');
        if (this.anime) setTimeout(() => this.listIn(), 0);
      });
    });
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const fromServer = !inject(Router).navigated;
    afterNextRender(() => void this.animate(fromServer));
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.cleanups.forEach((c) => c());
  }

  protected categoryName(id: number) {
    return this.result().data?.categories.find((c) => c.id === id)?.name ?? '';
  }

  protected short(type: string) {
    return { PDF: 'PDF', Word: 'DOC', Excel: 'XLS', PowerPoint: 'PPT', Image: 'IMG' }[type] ?? type.slice(0, 4);
  }

  protected viewable(doc: DownloadItem) {
    return VIEWABLE.has(doc.file.type);
  }

  protected date(iso: string) {
    // A plain date ("2026-11-20") is that day in Nairobi, not midnight UTC.
    return day.format(new Date(iso.length === 10 ? `${iso}T12:00:00+03:00` : iso));
  }

  protected size(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  /** "today", "soon" (within 3 days), "open" or "closed": colours the deadline. */
  protected dueState(doc: DownloadItem) {
    if (doc.isClosed || !doc.closesAt) return 'closed';
    const at = new Date(doc.closesAt);
    if (dayKey.format(at) === dayKey.format(new Date())) return 'today';
    return at.getTime() - Date.now() < 3 * 86_400_000 ? 'soon' : 'open';
  }

  protected dueLabel(doc: DownloadItem) {
    const at = new Date(doc.closesAt!);
    const when = `${day.format(at)}, ${time.format(at)}`;
    if (doc.isClosed) return `Closed ${day.format(at)}`;
    // Whole calendar days in Nairobi, so 5 pm tomorrow is "tomorrow" at any time today.
    const days = Math.round((Date.parse(dayKey.format(at)) - Date.parse(dayKey.format(new Date()))) / 86_400_000);
    if (days <= 0) return `Closes today, ${time.format(at)}`;
    if (days === 1) return `Closes tomorrow, ${time.format(at)}`;
    return days <= 14 ? `Closes in ${days} days · ${when}` : `Closes ${when}`;
  }

  private async animate(fromServer: boolean) {
    if (!motionAllowed(this.site)) return;
    let anime: Anime;
    try {
      anime = await loadAnime();
    } catch {
      return;
    }
    if (this.destroyed) return;
    this.anime = anime;
    this.heroIn(anime, fromServer);
  }

  /** The heading lines rise, the papers are dealt onto the pile and the download arrow drops in and bobs. */
  private heroIn(anime: Anime, fromServer: boolean) {
    const hero = this.hero()?.nativeElement;
    const stack = this.stackEl()?.nativeElement;
    if (!hero || !stack) return;
    const lines = [...hero.querySelectorAll<HTMLElement>('[data-in]')];
    const sheets = [...stack.querySelectorAll<HTMLElement>('.d-sheet')];
    const arrow = stack.querySelector<HTMLElement>('.d-arrow');
    const rows = this.rows();
    const done = stage(
      anime,
      hero,
      fromServer,
      () => {
        anime.set(lines, { opacity: 0, translateY: '18px' });
        anime.set(sheets, { opacity: 0, translateY: '-40px', rotate: '0deg' });
        if (arrow) anime.set(arrow, { opacity: 0, scale: 0.4 });
        anime.set(rows, { opacity: 0, translateY: '16px' });
      },
      () => {
        const tl = anime.createTimeline({
          defaults: { ease: 'out(3)' },
          onComplete: () => {
            clearStyles(lines);
            clearStyles(sheets, ['opacity', 'transform']);
            clearStyles(rows);
            if (arrow) {
              clearStyles([arrow]);
              this.bob(anime, arrow);
            }
          },
        });
        tl.add(lines, { opacity: 1, translateY: '0px', duration: 650, delay: anime.stagger(80) }, 0);
        tl.add(sheets.slice().reverse(), { opacity: 1, translateY: '0px', duration: 700, ease: 'outBack(1.4)', delay: anime.stagger(120) }, 150);
        if (arrow) tl.add(arrow, { opacity: 1, scale: 1, duration: 600, ease: 'outElastic(1, .6)' }, 650);
        if (rows.length) tl.add(rows, { opacity: 1, translateY: '0px', duration: 550, delay: anime.stagger(60) }, 350);
      },
    );
    this.cleanups.push(done);
    if (fromServer && arrow && hero.getBoundingClientRect().top < window.innerHeight * 0.9) this.bob(anime, arrow);
  }

  /** The arrow keeps gently pointing down, like a download in progress. */
  private bob(anime: Anime, arrow: HTMLElement) {
    if (this.destroyed) return;
    const a = anime.animate(arrow, { translateY: ['0px', '7px'], duration: 1100, ease: 'inOut(2)', alternate: true, loop: true });
    this.cleanups.push(() => a.revert());
  }

  /** After changing category, the new list slides in one row after another. */
  private listIn() {
    const anime = this.anime;
    const rows = this.rows();
    if (!anime || this.destroyed || !rows.length) return;
    anime.animate(rows, {
      opacity: [0, 1],
      translateY: ['14px', '0px'],
      duration: 450,
      ease: 'out(3)',
      delay: anime.stagger(45, { start: 40 }),
      onComplete: () => clearStyles(rows),
    });
  }

  private rows() {
    return [...(this.list()?.nativeElement.querySelectorAll<HTMLElement>(':scope > .d-doc') ?? [])].slice(0, 12);
  }
}

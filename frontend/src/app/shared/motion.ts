import { isPlatformBrowser } from '@angular/common';
import { Directive, ElementRef, PLATFORM_ID, afterNextRender, inject, input, type OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { SiteStore } from '../core/site';

type Anime = typeof import('./anime');
type Timeline = ReturnType<Anime['createTimeline']>;

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let animeLoad: Promise<Anime> | null = null;
/** Anime.js is fetched once, the first time something animates. */
export const loadAnime = () => (animeLoad ??= import('./anime'));

/** True while the welcome screen still covers the page. It fires "splash-leave" on window as it lifts. */
const splashCovering = () => !!document.querySelector('.splash:not(.splash--leaving)');
const splashLeaves = () => new Promise<void>((done) => window.addEventListener('splash-leave', () => done(), { once: true }));

/** Movement is on unless the visitor asked their device for less, or the admin switched it off. */
export const motionAllowed = (site: SiteStore) => !reducedMotion() && site.setting<{ enabled?: boolean }>('banner.animations')?.enabled !== false;

const TITLE = '.hero__title, .section-title, .page-header h1';
const EYEBROW = '.hero__eyebrow, .eyebrow, .breadcrumbs';
const EASE = 'out(3)';

/**
 * Brings a block (or the page title area) in with Anime.js: the heading rises word by word, then the rest
 * follows in a way that suits the block (cards one after another, a photo from its side, a gallery from the middle).
 * Blocks below the fold play when scrolled to. Blocks on the first screen play as the welcome screen lifts,
 * or straight away after moving to another page; a page the server has already painted is left still, so it never flickers.
 * Timelines also get a line that draws itself as the visitor scrolls, and photo heroes a gentle depth effect.
 */
@Directive({ selector: '[appReveal]' })
export class Reveal implements OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly site = inject(SiteStore);
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    // Before the first navigation finishes, this block came with the server-rendered page.
    const fromServer = !inject(Router).navigated;
    afterNextRender(() => {
      const node = this.el.nativeElement;
      if (!motionAllowed(this.site)) return;
      if (node.querySelector('.timeline')) void this.drawTimeline(node);
      if (node.querySelector('.hero--image .hero__media')) void this.heroDepth(node);
      const belowFold = node.getBoundingClientRect().top > window.innerHeight * 0.9;
      const covered = splashCovering();
      if (!belowFold && fromServer && !covered) return;
      // Hidden until Anime.js has loaded and set the starting positions; the welcome screen hides it otherwise.
      if (!covered || belowFold) node.classList.add('reveal');
      void this.enter(node, belowFold, covered);
    });
  }

  private async enter(node: HTMLElement, belowFold: boolean, covered: boolean) {
    let anime: Anime;
    try {
      anime = await loadAnime();
    } catch {
      node.classList.remove('reveal');
      return;
    }
    if (this.destroyed) return;
    // The welcome screen lifted before the library arrived: the visitor has already seen this block.
    if (covered && !belowFold && !splashCovering()) return;
    const tl = this.build(anime, node);
    node.classList.remove('reveal');
    if (belowFold) {
      const observer = anime.onScroll({ target: node, enter: 'bottom-=10% top', onEnter: () => tl.play() });
      this.cleanups.push(() => observer.revert());
    } else if (covered) {
      await splashLeaves();
      if (!this.destroyed) setTimeout(() => tl.play(), 150);
    } else {
      tl.play();
    }
  }

  /** The entrance for this block, paused, with every part already moved to its starting position. */
  private build(anime: Anime, node: HTMLElement): Timeline {
    const all = (selector: string) => [...node.querySelectorAll<HTMLElement>(selector)];
    const restore: (() => void)[] = [];
    const moved: HTMLElement[] = [];
    const tl = anime.createTimeline({
      autoplay: false,
      defaults: { ease: EASE, duration: 700 },
      onComplete: () => finish(),
    });
    // Leaves no inline styles behind, so hover effects and the stylesheet work as before.
    // (cleanInlineStyles would put back the hidden starting state set below.)
    const finish = () => {
      moved.splice(0).forEach((el) => {
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
        if (!el.getAttribute('style')) el.removeAttribute('style');
      });
      restore.splice(0).forEach((fn) => fn());
    };
    const hide = (targets: HTMLElement | HTMLElement[], from: Record<string, string | number>) => {
      moved.push(...([] as HTMLElement[]).concat(targets));
      anime.set(targets, from);
    };
    this.cleanups.push(() => {
      tl.pause();
      finish();
    });
    // Elements with CSS entrances of their own hand over to this one.
    node.classList.add('motion');

    const rise = (targets: HTMLElement[], at: string | number, extra: Record<string, unknown> = {}, distance = '24px') => {
      if (!targets.length) return;
      hide(targets, { opacity: 0, translateY: distance });
      tl.add(targets, { opacity: 1, translateY: '0px', ...extra }, at);
    };

    rise(all(EYEBROW), 0, { duration: 500 }, '12px');

    const title = all(TITLE)[0];
    if (title) {
      const words = this.splitWords(anime, title, restore);
      hide(words, { opacity: 0, translateY: '0.55em' });
      tl.add(words, { opacity: 1, translateY: '0em', duration: 800, delay: anime.stagger(60) }, 100);
    }

    const after = title ? '<<+=250' : 0;
    const gallery = all('.gallery > li');
    const cards = all('.card-grid > .card, .stats > .stat, .timeline > li');
    const splitMedia = all('.split > .split__media, .split > .split__video')[0];

    if (gallery.length) {
      // Fills in from the middle of the grid outwards.
      const top = gallery[0].offsetTop;
      const cols = Math.max(1, gallery.filter((li) => li.offsetTop === top).length);
      hide(gallery, { opacity: 0, scale: 0.88 });
      tl.add(gallery, { opacity: 1, scale: 1, duration: 650, delay: anime.stagger(70, { grid: [cols, Math.ceil(gallery.length / cols)], from: 'center' }) }, after);
    } else if (cards.length) {
      rise(all('.section-intro'), after);
      rise(cards, title ? '<<+=150' : 0, { delay: anime.stagger(90) }, '40px');
    } else if (splitMedia) {
      // On wide screens the photo slides in from its own side; stacked on a phone it rises like the text.
      const wide = matchMedia('(min-width: 860px)').matches;
      const fromRight = splitMedia.closest('.split')!.classList.contains('split--reverse');
      if (wide) {
        hide(splitMedia, { opacity: 0, translateX: fromRight ? '56px' : '-56px' });
        tl.add(splitMedia, { opacity: 1, translateX: '0px', duration: 1000 }, 0);
      } else {
        rise([splitMedia], 0, { duration: 900 }, '32px');
      }
      rise(this.rest(node, '.split__body'), after, { delay: anime.stagger(90) });
    } else if (node.querySelector('.hero')) {
      rise(all('.hero__text, .hero__buttons, .hero__video, .hero__scroll'), after, { delay: anime.stagger(110) });
    } else {
      rise(this.rest(node, '.container'), after, { delay: anime.stagger(90) });
    }
    return tl;
  }

  /** The children of the first `parent` other than the eyebrow and heading, which have their own steps. */
  private rest(node: HTMLElement, parent: string): HTMLElement[] {
    const box = node.querySelector(parent);
    if (!box) return [];
    return [...box.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.matches(`${TITLE}, ${EYEBROW}`));
  }

  /**
   * Splits a heading into words. Anime.js keeps a hidden copy of the whole heading for screen readers.
   * Afterwards the heading gets back its original text node, which Angular still updates when the text changes.
   */
  private splitWords(anime: Anime, title: HTMLElement, restore: (() => void)[]): HTMLElement[] {
    const original = [...title.childNodes];
    const split = anime.splitText(title, { words: true });
    restore.push(() => {
      split.revert();
      title.replaceChildren(...original);
    });
    return split.words as HTMLElement[];
  }

  /** The timeline's line draws down as the visitor scrolls, and each date's dot lights up as the line reaches it. */
  private async drawTimeline(node: HTMLElement) {
    const list = node.querySelector<HTMLElement>('.timeline');
    const line = node.querySelector<SVGPathElement>('.timeline__line path');
    if (!list || !line) return;
    let anime: Anime;
    try {
      anime = await loadAnime();
    } catch {
      return;
    }
    if (this.destroyed) return;
    const items = [...list.children] as HTMLElement[];
    // Where each dot sits down the line, from 0 (top) to 1 (bottom).
    let stops: number[] = [];
    const measure = () => (stops = items.map((li) => (li.offsetTop + 14) / Math.max(1, list.offsetHeight)));
    measure();
    list.classList.add('timeline--drawing');
    const [drawable] = anime.createDrawable(line);
    const draw = anime.animate(drawable, {
      draw: ['0 0', '0 1'],
      ease: 'linear',
      autoplay: anime.onScroll({ target: list, enter: 'bottom-=20% top', leave: 'center bottom', sync: 0.3, onResize: measure }),
      onUpdate: (self) => items.forEach((li, i) => li.classList.toggle('timeline__item--reached', self.progress >= stops[i])),
    });
    this.cleanups.push(() => {
      draw.revert();
      list.classList.remove('timeline--drawing');
      items.forEach((li) => li.classList.remove('timeline__item--reached'));
    });
  }

  /**
   * While a photo hero scrolls away, its photo moves a little slower than the page and darkens slightly.
   * Wide screens only: on phones it would cost smooth scrolling for little gain.
   */
  private async heroDepth(node: HTMLElement) {
    if (!matchMedia('(min-width: 860px)').matches) return;
    const hero = node.querySelector<HTMLElement>('.hero--image')!;
    const media = hero.querySelector<HTMLElement>('.hero__media')!;
    let anime: Anime;
    try {
      anime = await loadAnime();
    } catch {
      return;
    }
    if (this.destroyed) return;
    // Only a CSS variable moves; styles.scss turns it into the photo's offset and shade.
    const depth = anime.animate(media, {
      '--depth': [0, 1],
      ease: 'linear',
      autoplay: anime.onScroll({ target: hero, enter: 'top top', leave: 'top bottom', sync: true }),
    });
    this.cleanups.push(() => depth.revert());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanups.splice(0).forEach((fn) => fn());
  }
}

/**
 * Counts a statistic up from zero when it comes into view ("2,400", "92%", "120+", "KSh 1.2M").
 * The real value is rendered on the server, so search engines and no-JS visitors see it unchanged.
 */
@Directive({ selector: '[appCountUp]' })
export class CountUp implements OnDestroy {
  readonly appCountUp = input.required<string>();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly site = inject(SiteStore);
  private observer: IntersectionObserver | null = null;
  private frame = 0;

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    afterNextRender(() => {
      const match = this.appCountUp().match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
      if (!match || !motionAllowed(this.site) || typeof IntersectionObserver === 'undefined') return;
      const [, prefix, digits, suffix] = match;
      const target = Number(digits.replace(/,/g, ''));
      const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
      const commas = digits.includes(',');
      const format = (n: number) => {
        const fixed = n.toFixed(decimals);
        return prefix + (commas ? Number(fixed).toLocaleString('en-KE', { minimumFractionDigits: decimals }) : fixed) + suffix;
      };
      const node = this.el.nativeElement;
      // The orange line above the figure draws across as it counts (styles.scss, .stat--counting).
      const stat = node.closest('.stat');
      stat?.classList.add('stat--waiting');
      node.textContent = format(0);
      this.observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        this.observer?.disconnect();
        stat?.classList.replace('stat--waiting', 'stat--counting');
        const start = performance.now();
        const duration = 1800;
        // Fast at first, then settles gently onto the real figure (exponential ease-out).
        const ease = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          node.textContent = format(target * ease(t));
          if (t < 1) this.frame = requestAnimationFrame(tick);
          else node.textContent = this.appCountUp();
        };
        this.frame = requestAnimationFrame(tick);
      });
      this.observer.observe(node);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    // Only set in the browser; the server has no animation frames.
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}

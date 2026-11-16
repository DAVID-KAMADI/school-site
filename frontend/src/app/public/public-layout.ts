import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, HostListener, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import type { MediaView, MenuLink } from '../core/models';
import { SiteStore } from '../core/site';
import { CmsLink } from '../shared/cms-link';
import { motionAllowed } from '../shared/motion';
import { MediaImage } from '../shared/media-image';
import { MaintenanceStore } from '../core/maintenance';
import { CookieNotice } from './cookie-notice';
import { MaintenancePage } from './maintenance-page';
import { LanguageSwitcher } from './language-switcher';
import { isNotFoundRoute } from './not-found';
import { isUnavailableRoute } from './server-unavailable';
import { SplashScreen } from './splash-screen';

interface Banner {
  enabled: boolean;
  text: string;
  link: string | null;
  level?: 'info' | 'warning' | 'critical';
  deadline?: string | null;
}

/** Pause after the welcome screen lifts, so the page is seen before the pop-up covers it. */
const POPUP_DELAY_MS = 700;
/** How long a hover-opened menu waits after the mouse leaves before closing. */
const DROPDOWN_CLOSE_DELAY_MS = 180;
/** Length of the pop-up's closing transition in public-layout.scss. */
const POPUP_LEAVE_MS = 260;

/** Smallest sideways drag, in pixels, that counts as a swipe to the next or previous pop-up. */
const SWIPE_MIN_PX = 45;

interface IntakePopup {
  id: number;
  name: string;
  updatedAt: string;
  closesAt: string;
  title: string;
  details: string;
  image: MediaView;
}

/** Made in Admin → Pop-ups. */
interface SitePopup {
  id: number;
  kind: 'announcement' | 'event' | 'offer' | 'course' | 'news';
  isPriority: boolean;
  label: string | null;
  title: string;
  details: string;
  eventAt: string | null;
  buttonLabel: string | null;
  buttonLink: string | null;
  image: MediaView | null;
}

/** One card in the pop-up carousel, from an intake or from Admin → Pop-ups. */
interface PopupSlide {
  key: string;
  kind: SitePopup['kind'] | 'intake';
  eyebrow: string;
  title: string;
  details: string;
  image: MediaView | null;
  /** On the photo, e.g. "Applications open" (live dot) or "In 3 days". */
  badge: { text: string; live: boolean } | null;
  /** Deadline or event date, with a calendar icon. */
  when: string | null;
  cta: { label: string; href: string; internal: boolean } | null;
}

const KIND_LABELS: Record<SitePopup['kind'], string> = {
  announcement: 'Announcement',
  event: 'Upcoming event',
  offer: 'Special offer',
  course: 'New course',
  news: 'News',
};

/** Public header, banners and footer. Every word, link and image here comes from the admin. */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, CmsLink, MediaImage, LanguageSwitcher, SplashScreen, CdkTrapFocus, CookieNotice, MaintenancePage],
  templateUrl: './public-layout.html',
  styleUrl: './public-layout.scss',
})
export class PublicLayout {
  protected readonly site = inject(SiteStore);
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly menuOpen = signal(false);
  protected readonly openDropdown = signal<number | null>(null);
  protected readonly alertDismissed = signal(false);
  /** Pop-ups on screen: priority pop-ups, then every open intake with one switched on, then the other pop-ups. */
  protected readonly popups = signal<PopupSlide[]>([]);
  protected readonly popupIndex = signal(0);
  protected readonly popup = computed(() => this.popups()[this.popupIndex()] ?? null);
  /** Which way the last change went, so the new card slides in from that side. */
  protected readonly popupDirection = signal<'next' | 'prev' | null>(null);
  /** The "swipe" hint shows until the visitor moves between pop-ups once. */
  protected readonly popupBrowsed = signal(false);
  /** Finger or mouse drag in progress, in pixels, so the card follows it. */
  protected readonly popupDrag = signal(0);
  protected readonly popupLeaving = signal(false);
  /** Compact header once the visitor scrolls. */
  protected readonly scrolled = signal(false);
  /** A "page not found" or "can't reach the server": shown on its own, without the header, banners, welcome screen or footer. */
  protected readonly bare = signal(false);
  private readonly maintenance = inject(MaintenanceStore);
  /** ?maintenance-preview in the address: shows the maintenance page (the "Preview" on Admin → Maintenance mode). */
  protected readonly maintenancePreview = signal(false);
  /** Maintenance mode (or a backup restore): visitors get the maintenance page instead of the site. */
  protected readonly showMaintenance = computed(() => {
    const m = this.maintenance.status();
    return this.maintenancePreview() || (!!m?.active && !m.bypass);
  });
  /** Signed-in staff during maintenance see the site, with a strip reminding them visitors do not. */
  protected readonly staffMaintenanceNotice = computed(() => !!this.maintenance.status()?.active && !!this.maintenance.status()?.bypass);
  /** The page stands on its own, without header, banners, footer or pop-ups. */
  protected readonly alone = computed(() => this.bare() || this.showMaintenance());
  /** Page animations on (Site settings → Banners → Page animations) and not turned down on the device. */
  protected readonly motion = computed(() => this.browser && motionAllowed(this.site));

  protected readonly main = computed(() => this.site.menu('main').filter((i) => !i.isButton));
  protected readonly mainButtons = computed(() => this.site.menu('main').filter((i) => i.isButton));
  protected readonly blogInMain = computed(() => this.main().some((item) => item.href.replace(/\/$/, '') === '/blog'));
  protected readonly utility = computed(() => this.site.menu('utility'));
  protected readonly footer = computed(() => this.site.menu('footer'));
  protected readonly legal = computed(() => this.site.menu('legal'));
  protected readonly logo = computed(() => this.site.media(this.site.setting('institution.logo_media_id')));
  protected readonly alert = computed(() => this.site.setting<Banner>('banner.alert'));
  protected readonly intake = computed(() => this.site.setting<Banner>('banner.intake'));
  protected readonly social = computed(() =>
    Object.entries(this.site.setting<Record<string, string>>('social.links') ?? {})
      .filter(([, url]) => !!url)
      .map(([name, url]) => ({ name: SOCIAL_NAMES[name] ?? name, url })),
  );

  constructor() {
    const router = inject(Router);
    const route = inject(ActivatedRoute);
    this.bare.set(isNotFoundRoute(route.snapshot, this.site) || isUnavailableRoute(route.snapshot));
    this.maintenancePreview.set(route.snapshot.queryParamMap.has('maintenance-preview'));
    router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.menuOpen.set(false);
      this.openDropdown.set(null);
      this.bare.set(isNotFoundRoute(route.snapshot, this.site) || isUnavailableRoute(route.snapshot));
      this.maintenancePreview.set(route.snapshot.queryParamMap.has('maintenance-preview'));
    });
    if (this.browser) this.magnetButtons();
    if (this.browser) {
      try {
        const text = this.alert()?.text ?? '';
        this.alertDismissed.set(!!text && sessionStorage.getItem('alert-dismissed') === text);
      } catch {
        /* storage unavailable */
      }
      if (!this.showMaintenance()) void this.loadPopups();
      // The page stops scrolling only while the pop-up is actually on screen. A "page not found" hides
      // the pop-up with the rest of the site, so it must not keep the page locked either.
      effect(() => {
        document.documentElement.style.overflow = this.popup() && !this.alone() ? 'hidden' : '';
      });
    }
  }

  /** Shown on every visit (each time the site is opened or refreshed), once the welcome screen has lifted. */
  private async loadPopups() {
    const get = <T>(url: string, what: string) =>
      firstValueFrom(this.http.get<T[] | null>(url)).catch((error: unknown) => {
        console.error(`Unable to load the ${what}.`, error);
        return null;
      });
    const [intakes, others] = await Promise.all([
      get<IntakePopup>('/api/v1/public/admissions/intake-popups', 'intake pop-ups'),
      get<SitePopup>('/api/v1/public/popups', 'website pop-ups'),
    ]);
    // Priority pop-ups first, then open intakes, then the other pop-ups (each group in its admin order).
    const site = others ?? [];
    const slides = [
      ...site.filter((p) => p.isPriority).map((p) => this.siteSlide(p)),
      ...(intakes ?? []).map((i) => this.intakeSlide(i)),
      ...site.filter((p) => !p.isPriority).map((p) => this.siteSlide(p)),
    ];
    if (!slides.length) return;
    if (document.querySelector('.splash:not(.splash--leaving)')) {
      await new Promise<void>((done) => window.addEventListener('splash-leave', () => done(), { once: true }));
    }
    setTimeout(() => {
      this.popupIndex.set(0);
      this.popups.set(slides);
    }, POPUP_DELAY_MS);
  }

  private intakeSlide(popup: IntakePopup): PopupSlide {
    return {
      key: `intake-${popup.id}`,
      kind: 'intake',
      eyebrow: `${popup.name} intake`,
      title: popup.title,
      details: popup.details,
      image: popup.image,
      badge: { text: 'Applications open', live: true },
      when: this.popupDeadline(popup),
      cta: { label: 'Apply now', href: '/apply', internal: true },
    };
  }

  private siteSlide(popup: SitePopup): PopupSlide {
    const link = popup.buttonLink;
    const at = popup.eventAt ? new Date(popup.eventAt) : null;
    return {
      key: `popup-${popup.id}`,
      kind: popup.kind,
      eyebrow: popup.label || KIND_LABELS[popup.kind],
      title: popup.title,
      details: popup.details,
      image: popup.image,
      badge: at ? this.eventCountdown(at) : null,
      when: at
        ? at.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : null,
      cta:
        popup.buttonLabel && link
          ? { label: popup.buttonLabel, href: link, internal: link.startsWith('/') && !link.startsWith('//') }
          : null,
    };
  }

  /** "Today", "Tomorrow" or "In 5 days" on the photo of an event coming up within a month. */
  private eventCountdown(at: Date): PopupSlide['badge'] {
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((day(at) - day(new Date())) / 86_400_000);
    if (days < 0 || days > 30) return null;
    return { text: days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`, live: days <= 1 };
  }

  /** "Applications close 12 December 2026", or how many days are left in the last fortnight. */
  private popupDeadline(popup: IntakePopup) {
    const closes = new Date(popup.closesAt);
    const days = Math.ceil((closes.getTime() - Date.now()) / 86_400_000);
    if (days <= 1) return 'Applications close today';
    if (days <= 14) return `Only ${days} days left to apply`;
    return `Applications close ${closes.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }

  /** Moves to another pop-up; past the last one it wraps round to the first. */
  protected showPopup(step: 1 | -1) {
    const count = this.popups().length;
    if (count < 2 || this.popupLeaving()) return;
    this.popupDirection.set(step > 0 ? 'next' : 'prev');
    this.popupBrowsed.set(true);
    this.popupIndex.update((i) => (i + step + count) % count);
  }

  protected goToPopup(index: number) {
    if (index === this.popupIndex()) return;
    this.popupDirection.set(index > this.popupIndex() ? 'next' : 'prev');
    this.popupBrowsed.set(true);
    this.popupIndex.set(index);
  }

  private swipeStart: { x: number; y: number; id: number } | null = null;

  protected popupPointerDown(e: PointerEvent) {
    if (this.popups().length < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // With a mouse, buttons, links and selecting text keep working as usual.
    if (e.pointerType === 'mouse' && (e.target as Element).closest?.('a, button, .intake-popup__details')) return;
    this.swipeStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  protected popupPointerMove(e: PointerEvent) {
    if (!this.swipeStart || e.pointerId !== this.swipeStart.id) return;
    const dx = e.clientX - this.swipeStart.x;
    const dy = e.clientY - this.swipeStart.y;
    // Mostly up and down: the visitor is scrolling the text, not swiping.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      this.popupPointerCancel();
      return;
    }
    this.popupDrag.set(dx);
  }

  protected popupPointerUp(e: PointerEvent) {
    if (!this.swipeStart || e.pointerId !== this.swipeStart.id) return;
    const dx = e.clientX - this.swipeStart.x;
    this.popupPointerCancel();
    if (Math.abs(dx) >= SWIPE_MIN_PX) this.showPopup(dx < 0 ? 1 : -1);
  }

  protected popupPointerCancel() {
    this.swipeStart = null;
    this.popupDrag.set(0);
  }

  protected dismissPopups() {
    if (!this.popup() || this.popupLeaving()) return;
    this.popupLeaving.set(true);
    setTimeout(() => {
      this.popups.set([]);
      this.popupIndex.set(0);
      this.popupLeaving.set(false);
    }, POPUP_LEAVE_MS);
  }

  @HostListener('document:keydown.escape')
  protected closePopupOnEscape() {
    this.dismissPopups();
  }

  /** Left and right arrow keys move between pop-ups. */
  @HostListener('document:keydown', ['$event'])
  protected popupArrowKeys(e: KeyboardEvent) {
    if (!this.popup() || this.alone()) return;
    if (e.key === 'ArrowRight') this.showPopup(1);
    else if (e.key === 'ArrowLeft') this.showPopup(-1);
  }

  @HostListener('window:scroll')
  protected onScroll() {
    const s = window.scrollY > 40;
    if (s !== this.scrolled()) this.scrolled.set(s);
  }

  /**
   * With a mouse, a button leans a few pixels towards the cursor while it is over it, then eases back.
   * One listener for the whole site, so buttons added later by the CMS get it too.
   */
  private magnetButtons() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let current: HTMLElement | null = null;
    const release = () => {
      current?.classList.remove('btn--magnet');
      current?.style.removeProperty('--mx');
      current?.style.removeProperty('--my');
      current = null;
    };
    const onMove = (e: PointerEvent) => {
      const btn = e.target instanceof Element ? e.target.closest<HTMLElement>('.btn') : null;
      if (btn !== current) release();
      if (!btn || !motionAllowed(this.site)) return;
      const r = btn.getBoundingClientRect();
      const pull = (offset: number, size: number, max: number) => `${Math.max(-max, Math.min(max, (offset / size) * max * 2)).toFixed(1)}px`;
      btn.style.setProperty('--mx', pull(e.clientX - r.left - r.width / 2, r.width, 6));
      btn.style.setProperty('--my', pull(e.clientY - r.top - r.height / 2, r.height, 4));
      btn.classList.add('btn--magnet');
      current = btn;
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);
    inject(DestroyRef).onDestroy(() => {
      release();
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', release);
    });
  }

  protected dismissAlert() {
    this.alertDismissed.set(true);
    try {
      sessionStorage.setItem('alert-dismissed', this.alert()?.text ?? '');
    } catch {
      /* storage unavailable */
    }
  }

  protected toggleDropdown(i: number) {
    // The hover already opened it: the click that usually follows keeps it open rather than closing it.
    if (this.hoverOpened === i) {
      this.hoverOpened = null;
      return;
    }
    this.openDropdown.update((cur) => (cur === i ? null : i));
  }

  protected closeDropdownOnEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') this.openDropdown.set(null);
  }

  private dropdownCloseTimer?: ReturnType<typeof setTimeout>;
  private hoverOpened: number | null = null;
  /** On a desktop with a mouse, menus open on hover; phones and keyboards still use the toggle button. */
  private readonly hoverMenus = () => this.browser && matchMedia('(min-width: 1001px) and (hover: hover)').matches;

  protected hoverDropdown(i: number | null) {
    if (!this.hoverMenus()) return;
    clearTimeout(this.dropdownCloseTimer);
    this.hoverOpened = i !== null && this.openDropdown() !== i ? i : null;
    this.openDropdown.set(i);
  }

  /** A short grace period, so moving the mouse across to the menu or slightly off it does not snap it shut. */
  protected leaveDropdown() {
    if (!this.hoverMenus()) return;
    clearTimeout(this.dropdownCloseTimer);
    this.dropdownCloseTimer = setTimeout(() => {
      this.openDropdown.set(null);
      this.hoverOpened = null;
    }, DROPDOWN_CLOSE_DELAY_MS);
  }

  @HostListener('document:click', ['$event'])
  protected closeDropdownOnOutsideClick(e: MouseEvent) {
    if (this.openDropdown() !== null && !(e.target as Element).closest?.('.main-nav__item')) this.openDropdown.set(null);
  }

  /** Pages on this site always open in the same tab; only links to other websites may open a new one. */
  protected asLink(item: MenuLink) {
    const internal = item.href.startsWith('/') && !item.href.startsWith('//');
    return { label: item.label, href: item.href, openInNewTab: item.openInNewTab && !internal };
  }

  protected tel(phone: string) {
    return `tel:${phone.replace(/\s/g, '')}`;
  }

  protected whatsapp(phone: string) {
    return `https://wa.me/${phone.replace(/\D/g, '')}`;
  }
}

const SOCIAL_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  x: 'X (Twitter)',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};

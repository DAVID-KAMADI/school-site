import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, HostListener, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import type { MediaView, MenuLink } from '../core/models';
import { SiteStore } from '../core/site';
import { CmsLink } from '../shared/cms-link';
import { motionAllowed } from '../shared/motion';
import { MediaImage } from '../shared/media-image';
import { LanguageSwitcher } from './language-switcher';
import { isNotFoundRoute } from './not-found';
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

interface IntakePopup {
  id: number;
  name: string;
  updatedAt: string;
  closesAt: string;
  title: string;
  details: string;
  image: MediaView;
}

/** Public header, banners and footer. Every word, link and image here comes from the admin. */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, CmsLink, MediaImage, LanguageSwitcher, SplashScreen, CdkTrapFocus],
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
  protected readonly intakePopup = signal<IntakePopup | null>(null);
  protected readonly popupLeaving = signal(false);
  /** Compact header once the visitor scrolls. */
  protected readonly scrolled = signal(false);
  /** A "page not found": shown on its own, without the header, banners, welcome screen or footer. */
  protected readonly bare = signal(false);
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
    this.bare.set(isNotFoundRoute(route.snapshot, this.site));
    router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.menuOpen.set(false);
      this.openDropdown.set(null);
      this.bare.set(isNotFoundRoute(route.snapshot, this.site));
    });
    if (this.browser) this.magnetButtons();
    if (this.browser) {
      try {
        const text = this.alert()?.text ?? '';
        this.alertDismissed.set(!!text && sessionStorage.getItem('alert-dismissed') === text);
      } catch {
        /* storage unavailable */
      }
      void this.loadIntakePopup();
    }
  }

  /** Shown on every visit (each time the site is opened or refreshed), once the welcome screen has lifted. */
  private async loadIntakePopup() {
    try {
      const popup = await firstValueFrom(
        this.http.get<IntakePopup | null>('/api/v1/public/admissions/intake-popup'),
      );
      if (!popup) return;
      if (document.querySelector('.splash:not(.splash--leaving)')) {
        await new Promise<void>((done) => window.addEventListener('splash-leave', () => done(), { once: true }));
      }
      setTimeout(() => {
        this.intakePopup.set(popup);
        document.documentElement.style.overflow = 'hidden';
      }, POPUP_DELAY_MS);
    } catch (error) {
      console.error('Unable to load the current intake pop-up.', error);
    }
  }

  /** "Applications close 12 December 2026", or how many days are left in the last fortnight. */
  protected popupDeadline(popup: IntakePopup) {
    const closes = new Date(popup.closesAt);
    const days = Math.ceil((closes.getTime() - Date.now()) / 86_400_000);
    if (days <= 1) return 'Applications close today';
    if (days <= 14) return `Only ${days} days left to apply`;
    return `Applications close ${closes.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }

  protected dismissIntakePopup() {
    if (!this.intakePopup() || this.popupLeaving()) return;
    this.popupLeaving.set(true);
    setTimeout(() => {
      this.intakePopup.set(null);
      this.popupLeaving.set(false);
      document.documentElement.style.overflow = '';
    }, POPUP_LEAVE_MS);
  }

  @HostListener('document:keydown.escape')
  protected closePopupOnEscape() {
    this.dismissIntakePopup();
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

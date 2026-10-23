import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, HostListener, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import type { MenuLink } from '../core/models';
import { SiteStore } from '../core/site';
import { CmsLink } from '../shared/cms-link';
import { motionAllowed } from '../shared/motion';
import { MediaImage } from '../shared/media-image';
import { LanguageSwitcher } from './language-switcher';
import { SplashScreen } from './splash-screen';

interface Banner {
  enabled: boolean;
  text: string;
  link: string | null;
  level?: 'info' | 'warning' | 'critical';
  deadline?: string | null;
}

/** Public header, banners and footer. Every word, link and image here comes from the admin. */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, CmsLink, MediaImage, LanguageSwitcher, SplashScreen],
  templateUrl: './public-layout.html',
  styleUrl: './public-layout.scss',
})
export class PublicLayout {
  protected readonly site = inject(SiteStore);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly menuOpen = signal(false);
  protected readonly openDropdown = signal<number | null>(null);
  protected readonly alertDismissed = signal(false);
  /** Compact header once the visitor scrolls. */
  protected readonly scrolled = signal(false);
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
    router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.menuOpen.set(false);
      this.openDropdown.set(null);
    });
    if (this.browser) this.magnetButtons();
    if (this.browser) {
      try {
        const text = this.alert()?.text ?? '';
        this.alertDismissed.set(!!text && sessionStorage.getItem('alert-dismissed') === text);
      } catch {
        /* storage unavailable */
      }
    }
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
    this.openDropdown.update((cur) => (cur === i ? null : i));
  }

  protected closeDropdownOnEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') this.openDropdown.set(null);
  }

  protected asLink(item: MenuLink) {
    return { label: item.label, href: item.href, openInNewTab: item.openInNewTab };
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

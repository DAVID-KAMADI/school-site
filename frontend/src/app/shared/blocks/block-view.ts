import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import type { Block, MediaMap } from '../../core/models';
import { SiteStore } from '../../core/site';
import { CmsLink } from '../cms-link';
import { MediaImage } from '../media-image';
import { CountUp } from '../motion';
import { GalleryBlock } from './gallery-block';
import { HeroSlideshow } from './hero-slideshow';
import { ProgrammesBlock } from './programmes-block';
import { ShortCourseCard } from './short-course-card';
import { TabsBlock } from './tabs-block';
import { VideoEmbed } from './video-embed';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Renders one CMS block. The same component is used on the public site and in the admin live preview.
 * Rich text arrives already cleaned by the API and is bound with [innerHTML], which Angular sanitises again.
 */
@Component({
  selector: 'app-block-view',
  imports: [MediaImage, CmsLink, GalleryBlock, TabsBlock, VideoEmbed, RouterLink, HeroSlideshow, CountUp, NgTemplateOutlet, ProgrammesBlock, ShortCourseCard],
  templateUrl: './block-view.html',
  styleUrl: './block-view.scss',
})
export class BlockView {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly site = inject(SiteStore);

  readonly block = input.required<Block>();
  readonly media = input<MediaMap>({});
  /** True for the first block on the page, so its image loads immediately. */
  readonly first = input(false);

  protected readonly c = computed(() => this.block().content as Record<string, any>);
  protected readonly background = computed(() => `bg-${(this.c()['background'] as string) ?? 'default'}`);

  /** Main hero photo followed by any slideshow photos that exist. */
  protected readonly heroSlides = computed(() => {
    if (this.block().type !== 'hero') return [];
    const ids = [this.c()['mediaId'], ...((this.c()['slides'] as unknown[]) ?? [])];
    return ids.map((id) => this.m(id)).filter((x): x is NonNullable<typeof x> => !!x);
  });

  /** Background video for the hero, if one is set and it really is a video. */
  protected readonly heroVideo = computed(() => {
    if (this.block().type !== 'hero') return null;
    const v = this.m(this.c()['videoId']);
    return v?.kind === 'video' ? v : null;
  });

  protected m(id: unknown) {
    return typeof id === 'number' ? (this.media()[String(id)] ?? null) : null;
  }

  protected fileSize(bytes: number): string {
    return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected fileType(mime: string, name: string): string {
    if (mime === 'application/pdf') return 'PDF';
    const ext = name.split('.').pop()?.toUpperCase();
    return ext && ext.length <= 4 ? ext : 'File';
  }

  /** OpenStreetMap embed built only from validated numbers, so it is safe to trust. */
  protected readonly mapUrl = computed(() => {
    if (this.block().type !== 'map') return null;
    const { lat, lng, zoom } = this.c() as { lat: number; lng: number; zoom: number };
    const d = 0.02 * Math.pow(2, 16 - (zoom ?? 16));
    const bbox = [lng - d, lat - d / 2, lng + d, lat + d / 2].map((n) => n.toFixed(5)).join(',');
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`,
    );
  });

  protected contactLinks() {
    const phone = this.site.setting<string>('contact.phone');
    const whatsapp = this.site.setting<string>('contact.whatsapp');
    const email = this.site.setting<string>('contact.email');
    return [
      phone && { label: phone, href: `tel:${phone.replace(/\s/g, '')}`, kind: 'Phone' },
      whatsapp && { label: whatsapp, href: `https://wa.me/${whatsapp.replace(/\D/g, '')}`, kind: 'WhatsApp' },
      email && { label: email, href: `mailto:${email}`, kind: 'Email' },
    ].filter(Boolean) as { label: string; href: string; kind: string }[];
  }
}

import { Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import type { MediaMap } from '../../core/models';
import { SiteStore } from '../../core/site';
import { MediaImage } from '../media-image';
import { loadAnime, motionAllowed } from '../motion';

interface GalleryItem {
  mediaId: number;
  caption: string;
}

/**
 * Photo grid with an accessible lightbox (Esc to close, arrow keys to move, focus returned on close).
 * The photo grows out of the thumbnail that was opened, and on touch screens visitors swipe between photos.
 */
@Component({
  selector: 'app-gallery-block',
  imports: [MediaImage],
  template: `
    @if (heading()) {
      <h2 class="section-title">{{ heading() }}</h2>
    }
    <ul class="gallery">
      @for (item of items(); track $index; let i = $index) {
        <li>
          <button type="button" class="gallery__thumb" (click)="open(i, $event)" [attr.aria-label]="'Open photo ' + (i + 1) + ' of ' + items().length">
            <app-media-image [media]="media()[item.mediaId]" sizes="(min-width: 900px) 25vw, 50vw" />
          </button>
        </li>
      }
    </ul>

    @if (current() !== null) {
      <div
        #dialog
        class="lightbox"
        role="dialog"
        aria-modal="true"
        aria-label="Photo viewer"
        tabindex="-1"
        (keydown)="onKey($event)"
        (click)="close()"
      >
        <figure
          #figure
          (click)="$event.stopPropagation()"
          (pointerdown)="swipeStart($event)"
          (pointermove)="swipeMove($event)"
          (pointerup)="swipeEnd()"
          (pointercancel)="swipeEnd()"
        >
          <app-media-image [media]="media()[active()!.mediaId]" sizes="90vw" [eager]="true" />
          @if (active()!.caption || media()[active()!.mediaId]?.caption) {
            <figcaption>{{ active()!.caption || media()[active()!.mediaId]?.caption }}</figcaption>
          }
        </figure>
        <button type="button" class="lightbox__btn lightbox__close" (click)="close()" aria-label="Close">✕</button>
        @if (items().length > 1) {
          <button type="button" class="lightbox__btn lightbox__prev" (click)="move(-1, $event)" aria-label="Previous photo">‹</button>
          <button type="button" class="lightbox__btn lightbox__next" (click)="move(1, $event)" aria-label="Next photo">›</button>
        }
      </div>
    }
  `,
  styles: `
    .gallery { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); }
    .gallery__thumb { display: block; width: 100%; aspect-ratio: 4 / 3; padding: 0; border: 0; cursor: zoom-in; overflow: hidden; border-radius: var(--radius-sm); background: var(--surface-2); }
    .gallery__thumb app-media-image { height: 100%; transition: scale 0.5s ease; }
    .gallery__thumb:hover app-media-image, .gallery__thumb:focus-visible app-media-image { scale: 1.04; }
    .lightbox { position: fixed; inset: 0; z-index: 100; background: rgb(0 0 0 / 0.9); display: grid; place-items: center; padding: 3rem 1rem; animation: backdrop-in 0.3s ease both; }
    @keyframes backdrop-in { from { background-color: rgb(0 0 0 / 0); } }
    /* pan-y: horizontal swipes are ours (next or previous photo); vertical ones still scroll. */
    .lightbox figure { margin: 0; max-width: min(1200px, 100%); max-height: 100%; display: grid; gap: 0.75rem; touch-action: pan-y; }
    .lightbox figure app-media-image { max-height: 80vh; }
    .lightbox figure ::ng-deep img { object-fit: contain; max-height: 80vh; }
    figcaption { color: #fff; text-align: center; }
    .lightbox__btn { position: absolute; background: rgb(255 255 255 / 0.12); color: #fff; border: 0; width: 3rem; height: 3rem; border-radius: 50%; font-size: 1.6rem; cursor: pointer; }
    .lightbox__btn:hover, .lightbox__btn:focus-visible { background: rgb(255 255 255 / 0.25); }
    .lightbox__close { top: 1rem; right: 1rem; }
    .lightbox__prev { left: 1rem; top: 50%; translate: 0 -50%; }
    .lightbox__next { right: 1rem; top: 50%; translate: 0 -50%; }
  `,
})
export class GalleryBlock {
  readonly heading = input('');
  readonly items = input<GalleryItem[]>([]);
  readonly media = input<MediaMap>({});

  protected readonly current = signal<number | null>(null);
  protected readonly active = computed(() => (this.current() === null ? null : this.items()[this.current()!]));
  private readonly site = inject(SiteStore);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly figure = viewChild<ElementRef<HTMLElement>>('figure');
  private returnFocus: HTMLElement | null = null;
  /** The finger currently swiping across the photo. */
  private swipe: { id: number; x: number; y: number; dx: number } | null = null;

  open(index: number, event: Event) {
    const thumb = event.currentTarget as HTMLElement;
    this.returnFocus = thumb;
    this.current.set(index);
    setTimeout(() => {
      this.dialog()?.nativeElement.focus();
      void this.growFrom(thumb);
    });
  }

  /** Starts the photo at the size and place of its thumbnail, then lets it grow to full size. */
  private async growFrom(thumb: HTMLElement) {
    const photo = this.figure()?.nativeElement.querySelector<HTMLElement>('app-media-image');
    if (!photo || !motionAllowed(this.site)) return;
    const from = thumb.getBoundingClientRect();
    const to = photo.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const anime = await loadAnime().catch(() => null);
    if (!anime) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    anime.animate(photo, {
      translateX: [`${dx}px`, '0px'],
      translateY: [`${dy}px`, '0px'],
      scale: [from.width / to.width, 1],
      duration: 450,
      ease: 'out(4)',
      onComplete: () => photo.style.removeProperty('transform'),
    });
  }

  protected swipeStart(e: PointerEvent) {
    if (e.pointerType === 'mouse' || this.items().length < 2) return;
    this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0 };
  }

  /** The photo follows the finger sideways and fades a little. */
  protected swipeMove(e: PointerEvent) {
    const s = this.swipe;
    const fig = this.figure()?.nativeElement;
    if (!s || s.id !== e.pointerId || !fig) return;
    const dx = e.clientX - s.x;
    if (Math.abs(e.clientY - s.y) > Math.abs(dx)) return;
    s.dx = dx;
    fig.style.transform = `translateX(${dx}px)`;
    fig.style.opacity = String(1 - Math.min(0.5, Math.abs(dx) / 600));
  }

  /** A long enough swipe moves to the next or previous photo; a short one springs back. */
  protected swipeEnd() {
    const s = this.swipe;
    const fig = this.figure()?.nativeElement;
    this.swipe = null;
    if (!s || !fig || !s.dx) return;
    if (Math.abs(s.dx) > 60) {
      fig.style.removeProperty('transform');
      fig.style.removeProperty('opacity');
      this.move(s.dx < 0 ? 1 : -1);
      return;
    }
    if (!motionAllowed(this.site)) {
      fig.style.removeProperty('transform');
      fig.style.removeProperty('opacity');
      return;
    }
    void loadAnime().then((anime) =>
      anime.animate(fig, {
        translateX: '0px',
        opacity: 1,
        duration: 300,
        ease: 'out(3)',
        onComplete: () => fig.removeAttribute('style'),
      }),
    );
  }

  /** The new photo slides in from the side it came from. */
  private async slideIn(step: number) {
    const fig = this.figure()?.nativeElement;
    if (!fig || !motionAllowed(this.site)) return;
    const anime = await loadAnime().catch(() => null);
    if (!anime) return;
    anime.animate(fig, {
      translateX: [`${step * 48}px`, '0px'],
      opacity: [0, 1],
      duration: 380,
      ease: 'out(3)',
      onComplete: () => fig.removeAttribute('style'),
    });
  }

  close() {
    this.current.set(null);
    this.returnFocus?.focus();
  }

  move(step: number, event?: Event) {
    event?.stopPropagation();
    const n = this.items().length;
    this.current.update((i) => ((i ?? 0) + step + n) % n);
    void this.slideIn(step);
  }

  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.move(1);
    else if (e.key === 'ArrowLeft') this.move(-1);
  }
}

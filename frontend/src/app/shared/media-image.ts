import { Component, computed, input } from '@angular/core';
import type { MediaView } from '../core/models';

/**
 * Responsive image from the media library: WebP sizes via srcset, the original as fallback,
 * alt text from the library, and the editor's focal point kept in view when cropped.
 */
@Component({
  selector: 'app-media-image',
  template: `
    @if (media(); as m) {
      <picture>
        @if (webp()) {
          <source type="image/webp" [attr.srcset]="webp()" [attr.sizes]="sizes()" />
        }
        <img
          [src]="m.url"
          [alt]="decorative() ? '' : (alt() || m.altText || '')"
          [attr.width]="m.width"
          [attr.height]="m.height"
          [attr.loading]="eager() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="eager() ? 'high' : null"
          decoding="async"
          [style.object-position]="position()"
        />
      </picture>
    }
  `,
  styles: `
    :host { display: block; }
    picture, img { display: block; width: 100%; height: 100%; }
    img { object-fit: cover; }
  `,
})
export class MediaImage {
  readonly media = input<MediaView | null | undefined>(null);
  readonly sizes = input('100vw');
  /** Use for the main hero image so it is not lazy-loaded. */
  readonly eager = input(false);
  /** Purely decorative images get empty alt text so screen readers skip them. */
  readonly decorative = input(false);
  /** Optional context-specific alt text when the library image has no description. */
  readonly alt = input('');

  protected readonly webp = computed(() =>
    (this.media()?.srcset ?? [])
      .filter((s) => s.format === 'webp')
      .map((s) => `${s.url} ${s.width}w`)
      .join(', '),
  );
  protected readonly position = computed(() => {
    const m = this.media();
    return m ? `${Math.round(m.focalX * 100)}% ${Math.round(m.focalY * 100)}%` : null;
  });
}

import { Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/** Extracts a YouTube or Vimeo video id. Only these hosts are accepted by the API. */
export function parseVideo(url: string): { provider: 'youtube' | 'vimeo'; id: string } | null {
  const yt = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/i);
  if (yt) return { provider: 'youtube', id: yt[1] };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d{4,15})/i);
  return vimeo ? { provider: 'vimeo', id: vimeo[1] } : null;
}

/**
 * Click-to-play video: shows a light placeholder and only loads the player when the visitor asks,
 * which keeps pages fast and saves mobile data.
 */
@Component({
  selector: 'app-video-embed',
  template: `
    <div class="video">
      @if (playing() && embedUrl()) {
        <iframe
          [src]="embedUrl()"
          [title]="title()"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      } @else if (video()) {
        <button type="button" class="video__play" (click)="playing.set(true)">
          @if (thumbnail()) {
            <img [src]="thumbnail()" alt="" loading="lazy" />
          }
          <span class="video__icon" aria-hidden="true">▶</span>
          <span class="visually-hidden">Play video: {{ title() }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    .video { position: relative; aspect-ratio: 16 / 9; background: var(--ink); border-radius: var(--radius); overflow: hidden; }
    iframe, .video__play, img { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .video__play { cursor: pointer; padding: 0; background: var(--ink); }
    img { object-fit: cover; opacity: 0.85; }
    .video__icon {
      position: absolute; left: 50%; top: 50%; translate: -50% -50%;
      width: 4.5rem; height: 4.5rem; border-radius: 50%; display: grid; place-items: center;
      background: var(--accent); color: var(--on-accent); font-size: 1.5rem;
    }
    .video__play:hover .video__icon, .video__play:focus-visible .video__icon { scale: 1.08; }
  `,
})
export class VideoEmbed {
  private readonly sanitizer = inject(DomSanitizer);
  readonly url = input.required<string>();
  readonly title = input('Video');
  protected readonly playing = signal(false);
  protected readonly video = computed(() => parseVideo(this.url()));

  protected readonly thumbnail = computed(() => {
    const v = this.video();
    return v?.provider === 'youtube' ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null;
  });

  /** Built only from a validated id and a fixed host, so it is safe to mark as a trusted resource URL. */
  protected readonly embedUrl = computed(() => {
    const v = this.video();
    if (!v) return null;
    const src =
      v.provider === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`
        : `https://player.vimeo.com/video/${v.id}?autoplay=1&dnt=1`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(src);
  });
}

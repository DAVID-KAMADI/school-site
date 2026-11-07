import { Component, computed, inject, input, model, signal } from '@angular/core';
import type { MediaView } from '../../core/models';
import { MediaCache } from '../media/media-cache';
import { MediaLibrary } from '../media/media-library';

/** Chooses an image, video or document from the media library (or uploads one) for a block field. */
@Component({
  selector: 'app-media-field',
  imports: [MediaLibrary],
  template: `
    <div class="media-field">
      @if (current(); as m) {
        @if (m.kind === 'image') {
          <img [src]="m.srcset[0]?.url ?? m.url" [alt]="m.altText || ''" />
        } @else if (m.kind === 'video') {
          <video [src]="m.url + '#t=1'" preload="metadata" [muted]="true" playsinline></video>
        } @else {
          <span class="doc">{{ m.originalName }}</span>
        }
        <div class="media-field__info">
          <span class="a-small">{{ m.originalName }}</span>
          @if (m.kind === 'image' && !m.altText) {
            <span class="a-error">No alt text — add it in the media library.</span>
          }
          <div class="a-toolbar">
            <button type="button" class="a-btn a-btn--sm" (click)="open.set(true)">Change</button>
            <button type="button" class="a-btn a-btn--sm a-btn--danger" (click)="value.set(null)">Remove</button>
          </div>
        </div>
      } @else {
        <button type="button" class="a-btn" (click)="open.set(true)">{{ kind() === 'image' ? 'Choose image' : kind() === 'video' ? 'Choose video' : 'Choose file' }}</button>
      }
    </div>

    @if (open()) {
      <div class="a-modal-backdrop" (click)="open.set(false)">
        <div class="a-modal a-modal--wide" role="dialog" aria-modal="true" aria-label="Media library" (click)="$event.stopPropagation()">
          <div class="a-toolbar a-toolbar--spread">
            <h2>{{ kind() === 'image' ? 'Choose an image' : kind() === 'video' ? 'Choose a video' : 'Choose a document' }}</h2>
            <button type="button" class="a-btn a-btn--sm" (click)="open.set(false)">Close</button>
          </div>
          <app-media-library [pickerKind]="kind()" (picked)="pick($event)" />
        </div>
      </div>
    }
  `,
  styles: `
    .media-field { display: flex; gap: 0.75rem; align-items: center; }
    img, video { width: 6rem; height: 4.5rem; object-fit: cover; border-radius: 6px; border: 1px solid var(--a-line); }
    .doc { padding: 0.5rem 0.75rem; background: #eef1f4; border-radius: 6px; font-size: 0.8rem; max-width: 12rem; overflow: hidden; text-overflow: ellipsis; }
    .media-field__info { display: grid; gap: 0.3rem; min-width: 0; }
  `,
})
export class MediaField {
  private readonly cache = inject(MediaCache);
  readonly value = model<number | null>(null);
  readonly kind = input<'image' | 'document' | 'video'>('image');
  protected readonly open = signal(false);
  protected readonly current = computed(() => this.cache.get(this.value()));

  pick(m: MediaView) {
    this.cache.add(m);
    this.value.set(m.id);
    this.open.set(false);
  }
}

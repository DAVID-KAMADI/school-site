import { Injectable, signal } from '@angular/core';
import type { MediaMap, MediaView } from '../../core/models';

/** Media details the editor already knows about, so pickers and previews can show thumbnails without refetching. */
@Injectable({ providedIn: 'root' })
export class MediaCache {
  readonly map = signal<MediaMap>({});

  add(...items: (MediaView | null | undefined)[]) {
    const found = items.filter((m): m is MediaView => !!m);
    if (!found.length) return;
    this.map.update((cur) => ({ ...cur, ...Object.fromEntries(found.map((m) => [String(m.id), m])) }));
  }

  addMap(map: MediaMap) {
    this.map.update((cur) => ({ ...cur, ...map }));
  }

  get(id: unknown): MediaView | null {
    return typeof id === 'number' ? (this.map()[String(id)] ?? null) : null;
  }
}

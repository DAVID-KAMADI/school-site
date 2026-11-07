import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import type { MediaView } from '../../core/models';
import { AdminApi } from '../api';
import { MediaCache } from './media-cache';

type Usage = { entityType: string; entityId: string; fieldPath: string };

/** File types the upload button offers, per kind. */
const ACCEPT = {
  image: 'image/jpeg,image/png,image/webp,image/avif,image/gif',
  document: '.pdf,.docx,.xlsx,.pptx',
  video: 'video/mp4,video/webm,.mp4,.webm',
} as const;

/**
 * Media library. Used as its own admin screen and, with `pickerKind` set, inside the picker dialog
 * (clicking a file then chooses it).
 */
@Component({
  selector: 'app-media-library',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './media-library.html',
  styleUrl: './media-library.scss',
})
export class MediaLibrary {
  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  protected readonly auth = inject(AuthStore);

  /** When set, the library is in picker mode for this kind of file. */
  readonly pickerKind = input<'image' | 'document' | 'video' | null>(null);
  readonly picked = output<MediaView>();

  protected search = '';
  protected folder = '';
  protected kind = '';
  protected uploadFolder = '';
  protected readonly items = signal<MediaView[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly folders = signal<string[]>([]);
  protected readonly selected = signal<(MediaView & { usages?: Usage[] }) | null>(null);
  protected readonly busy = signal(false);
  protected readonly uploading = signal(0);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / 40)));
  protected readonly accept = computed(() =>
    this.pickerKind() ? ACCEPT[this.pickerKind()!] : Object.values(ACCEPT).join(','),
  );

  constructor() {
    queueMicrotask(() => {
      this.kind = this.pickerKind() ?? '';
      void this.load();
      void this.api.folders().then((f) => this.folders.set(f));
    });
  }

  async load(page = 1) {
    this.busy.set(true);
    try {
      const res = await this.api.media({ search: this.search, folder: this.folder, kind: this.kind || undefined, page });
      this.items.set(res.items);
      this.total.set(res.total);
      this.page.set(res.page);
      this.cache.add(...res.items);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.error.set('');
    let last: MediaView | null = null;
    for (const file of files) {
      this.uploading.update((n) => n + 1);
      try {
        last = await this.api.upload(file, { folder: this.uploadFolder || this.folder || undefined });
        this.cache.add(last);
      } catch (err) {
        this.error.set(`${file.name}: ${errorMessage(err)}`);
      } finally {
        this.uploading.update((n) => n - 1);
      }
    }
    await this.load();
    if (last) await this.select(last);
    if (last && this.pickerKind() && last.kind === this.pickerKind() && files.length === 1) {
      this.notice.set('Uploaded. Add alt text below, then choose “Use this file”.');
    }
  }

  async select(item: MediaView) {
    this.notice.set('');
    try {
      this.selected.set(await this.api.mediaItem(item.id));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  choose(item: MediaView) {
    this.picked.emit(item);
  }

  async save() {
    const s = this.selected();
    if (!s) return;
    try {
      const saved = await this.api.updateMedia(s.id, {
        altText: s.altText ?? '',
        caption: s.caption ?? '',
        credit: s.credit ?? '',
        hasConsent: s.hasConsent,
        folder: s.folder ?? '',
        focalX: s.focalX,
        focalY: s.focalY,
      });
      this.cache.add(saved);
      this.selected.set({ ...saved, usages: s.usages });
      this.items.update((list) => list.map((m) => (m.id === saved.id ? saved : m)));
      this.notice.set('Saved. Pages using this file show the change straight away.');
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  setFocal(event: MouseEvent) {
    const s = this.selected();
    const img = event.target as HTMLElement;
    if (!s) return;
    const rect = img.getBoundingClientRect();
    s.focalX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    s.focalY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    this.selected.set({ ...s });
  }

  async replace(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const s = this.selected();
    if (!file || !s) return;
    try {
      const saved = await this.api.replaceMedia(s.id, file);
      this.cache.add(saved);
      this.selected.set({ ...saved, usages: s.usages });
      await this.load(this.page());
      this.notice.set('File replaced everywhere it is used.');
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async remove() {
    const s = this.selected();
    if (!s) return;
    const inUse = s.usages?.length ?? 0;
    const question = inUse
      ? `This file is used in ${inUse} place(s). Deleting it will leave gaps on those pages. Delete anyway?`
      : `Delete ${s.originalName}?`;
    if (!confirm(question)) return;
    try {
      await this.api.deleteMedia(s.id, inUse > 0);
      this.selected.set(null);
      await this.load(this.page());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected size(bytes: number) {
    return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  protected thumb(m: MediaView) {
    return m.srcset.find((s) => s.width >= 320)?.url ?? m.url;
  }
}

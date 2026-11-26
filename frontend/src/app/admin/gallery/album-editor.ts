import { CdkDrag, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  Component,
  HostListener,
  computed,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink, type CanDeactivateFn } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import type { MediaView } from '../../core/models';
import { AdminApi, type AlbumDetail } from '../api';
import { MediaCache } from '../media/media-cache';
import { MediaLibrary } from '../media/media-library';
import { toastChannel } from '../toast';

export const albumUnsavedChangesGuard: CanDeactivateFn<AlbumEditor> = (editor) => editor.canLeave();

interface PhotoEdit {
  /** Stable key for the list while photos are moved around. */
  key: number;
  mediaId: number;
  caption: string;
}

interface Draft {
  title: string;
  slug: string;
  description: string;
  category: string;
  takenOn: string;
  coverImageId: number | null;
  isPublished: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

/** Admin → Gallery → one album: its details and photos (upload many at once, drag to reorder, pick the cover). */
@Component({
  selector: 'app-album-editor',
  imports: [FormsModule, RouterLink, CdkDropList, CdkDrag, MediaLibrary],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div class="a-toolbar">
        <a class="a-btn a-btn--sm" routerLink="/admin/gallery">← Gallery</a>
        <h1>{{ isNew() ? 'New album' : draft().title || 'Album' }}</h1>
        @if (!isNew()) {
          @if (savedPublished()) {
            <span class="a-badge a-badge--live">On the website</span>
          } @else {
            <span class="a-badge">Hidden</span>
          }
        }
        @if (dirty()) {
          <span class="a-badge a-badge--changes">Unsaved changes</span>
        }
      </div>
      <div class="a-toolbar">
        @if (!isNew() && savedPublished() && photos().length) {
          <a class="a-btn" [href]="'/gallery/' + savedSlug()" target="_blank" rel="noopener"
            >View on website</a
          >
        }
        <button
          class="a-btn a-btn--primary"
          type="button"
          (click)="save()"
          [disabled]="saving() || uploading() > 0"
        >
          {{ saving() ? 'Saving…' : 'Save album' }}
        </button>
      </div>
    </div>

    @if (error()) {
      <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
    }

    <div class="layout">
      <section class="a-panel a-stack details">
        <h2>Details</h2>
        <label class="a-field"
          ><span>Title</span>
          <input
            class="a-input"
            maxlength="120"
            placeholder="e.g. Graduation 2026"
            [ngModel]="draft().title"
            (ngModelChange)="patch({ title: $event })"
          />
        </label>
        <label class="a-field"
          ><span>Web address</span>
          <div class="slug">
            <span class="a-muted">/gallery/</span
            ><input
              class="a-input"
              maxlength="140"
              [placeholder]="autoSlug() || 'made from the title'"
              [ngModel]="draft().slug"
              (ngModelChange)="patch({ slug: $event })"
            />
          </div>
          <small class="a-muted">Leave empty to make it from the title.</small>
        </label>
        <div class="a-row">
          <label class="a-field"
            ><span>Category <small class="a-muted">(filter on the website)</small></span>
            <input
              class="a-input"
              maxlength="60"
              list="album-categories"
              placeholder="e.g. Events"
              [ngModel]="draft().category"
              (ngModelChange)="patch({ category: $event })"
            />
            <datalist id="album-categories">
              @for (c of categories(); track c) {
                <option [value]="c"></option>
              }
            </datalist>
          </label>
          <label class="a-field"
            ><span>Date taken <small class="a-muted">(optional)</small></span>
            <input
              class="a-input"
              type="date"
              [ngModel]="draft().takenOn"
              (ngModelChange)="patch({ takenOn: $event })"
            />
          </label>
        </div>
        <label class="a-field"
          ><span>Description <small class="a-muted">(optional)</small></span>
          <textarea
            class="a-textarea"
            rows="3"
            maxlength="1000"
            placeholder="A sentence or two about the occasion."
            [ngModel]="draft().description"
            (ngModelChange)="patch({ description: $event })"
          ></textarea>
        </label>
        <label class="a-field order"
          ><span>Order <small class="a-muted">(lower shows first)</small></span>
          <input
            class="a-input"
            type="number"
            min="0"
            max="9999"
            [ngModel]="draft().sortOrder"
            (ngModelChange)="patch({ sortOrder: $event })"
          />
        </label>
        <label class="a-check"
          ><input
            type="checkbox"
            [ngModel]="draft().isPublished"
            (ngModelChange)="patch({ isPublished: $event })"
          />
          Show this album on the website</label
        >
        <label class="a-check"
          ><input
            type="checkbox"
            [ngModel]="draft().isFeatured"
            (ngModelChange)="patch({ isFeatured: $event })"
          />
          Featured: show it large at the top of the Gallery page</label
        >
        @if (!isNew()) {
          <hr />
          <button class="a-btn a-btn--danger" type="button" (click)="remove()">Delete album</button>
          <p class="a-small a-muted">Deleting the album keeps its photos in the media library.</p>
        }
      </section>

      <section class="a-panel photos">
        <div class="a-toolbar a-toolbar--spread">
          <div>
            <h2>
              Photos <span class="a-muted">({{ photos().length }})</span>
            </h2>
            <p class="a-small a-muted">
              Drag to change the order. The cover (★) is shown on the album card; without one, the
              first photo is used.
            </p>
          </div>
          <div class="a-toolbar">
            <label class="a-btn a-btn--primary upload">
              Upload photos
              <input type="file" multiple [accept]="accept" (change)="upload($event)" />
            </label>
            <button class="a-btn" type="button" (click)="picking.set(true)">
              Add from media library
            </button>
          </div>
        </div>

        @if (uploading() > 0) {
          <div class="a-alert a-alert--info" role="status">
            Uploading… {{ uploaded() }} of {{ uploadTotal() }} done.
          </div>
        }

        @if (photos().length) {
          <ul
            class="grid"
            cdkDropList
            cdkDropListOrientation="mixed"
            (cdkDropListDropped)="drop($event)"
          >
            @for (p of photos(); track p.key; let i = $index) {
              <li class="tile" cdkDrag [class.tile--cover]="isCover(p)">
                <div class="tile__img">
                  @if (media(p.mediaId); as m) {
                    <img
                      [src]="m.srcset[0]?.url ?? m.url"
                      [alt]="m.altText || ''"
                      loading="lazy"
                      draggable="false"
                    />
                  } @else {
                    <span class="a-small a-muted">Photo #{{ p.mediaId }} is missing</span>
                  }
                  <span class="tile__n">{{ i + 1 }}</span>
                  <button
                    type="button"
                    class="tile__star"
                    [class.on]="isCover(p)"
                    (click)="setCover(p)"
                    [attr.aria-pressed]="isCover(p)"
                    [attr.aria-label]="isCover(p) ? 'This is the cover' : 'Use as cover'"
                    [title]="isCover(p) ? 'Cover photo' : 'Use as cover'"
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    class="tile__remove"
                    (click)="removePhoto(i)"
                    aria-label="Remove from album"
                    title="Remove from album"
                  >
                    ✕
                  </button>
                </div>
                <input
                  class="a-input tile__caption"
                  maxlength="300"
                  placeholder="Caption (optional)"
                  [ngModel]="p.caption"
                  (ngModelChange)="setCaption(i, $event)"
                />
              </li>
            }
          </ul>
        } @else {
          <label class="drop">
            <input type="file" multiple [accept]="accept" (change)="upload($event)" />
            <strong>Upload photos</strong>
            <span class="a-muted a-small"
              >Choose several at once. JPEG, PNG or WebP, up to 25 MB each.</span
            >
          </label>
        }
      </section>
    </div>

    @if (picking()) {
      <div class="a-modal-backdrop" (click)="picking.set(false)">
        <div
          class="a-modal a-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-label="Add photos from the media library"
          (click)="$event.stopPropagation()"
        >
          <div class="a-toolbar a-toolbar--spread">
            <div>
              <h2>Add photos</h2>
              <p class="a-small a-muted">
                Choose a photo and “Use this file” to add it. Add as many as you like, then close.
              </p>
            </div>
            <button type="button" class="a-btn a-btn--sm" (click)="picking.set(false)">Done</button>
          </div>
          <app-media-library pickerKind="image" (picked)="addPicked($event)" />
        </div>
      </div>
    }
  `,
  styles: `
    .head {
      margin-bottom: 1rem;
      gap: 1rem;
    }
    .layout {
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(18rem, 24rem) minmax(0, 1fr);
      align-items: start;
    }
    .details h2,
    .photos h2 {
      margin: 0;
      font-size: 1.1rem;
    }
    .details {
      position: sticky;
      top: 1rem;
    }
    .slug {
      display: flex;
      gap: 0.35rem;
      align-items: center;
    }
    .order {
      max-width: 12rem;
    }
    hr {
      width: 100%;
      border: 0;
      border-top: 1px solid var(--a-line);
    }
    .upload {
      position: relative;
      overflow: hidden;
      cursor: pointer;
    }
    .upload input,
    .drop input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .drop {
      position: relative;
      display: grid;
      gap: 0.35rem;
      place-items: center;
      margin-top: 1rem;
      padding: 3rem 1rem;
      border: 2px dashed var(--a-line-strong);
      border-radius: 12px;
      text-align: center;
      cursor: pointer;
    }
    .drop:hover {
      border-color: var(--a-primary, #0345bf);
      background: #f6f8fc;
    }
    .grid {
      list-style: none;
      margin: 1rem 0 0;
      padding: 0;
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    }
    .tile {
      display: grid;
      gap: 0.4rem;
      padding: 0.4rem;
      border: 1px solid var(--a-line);
      border-radius: 10px;
      background: #fff;
      cursor: grab;
    }
    .tile--cover {
      border-color: #ef6d00;
      box-shadow: 0 0 0 2px rgb(239 109 0 / 0.25);
    }
    .tile__img {
      position: relative;
      aspect-ratio: 4 / 3;
      overflow: hidden;
      border-radius: 6px;
      background: #eef1f6;
      display: grid;
      place-items: center;
    }
    .tile__img img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .tile__n {
      position: absolute;
      left: 0.35rem;
      bottom: 0.35rem;
      padding: 0 0.4rem;
      border-radius: 999px;
      background: rgb(0 0 0 / 0.55);
      color: #fff;
      font-size: 0.75rem;
    }
    .tile__star,
    .tile__remove {
      position: absolute;
      top: 0.35rem;
      width: 1.9rem;
      height: 1.9rem;
      border: 0;
      border-radius: 50%;
      background: rgb(255 255 255 / 0.92);
      cursor: pointer;
      font-size: 0.95rem;
      line-height: 1;
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
    }
    .tile__star {
      left: 0.35rem;
      color: #9aa3b2;
    }
    .tile__star.on {
      background: #ef6d00;
      color: #fff;
    }
    .tile__remove {
      right: 0.35rem;
      color: #b42318;
    }
    .tile__caption {
      font-size: 0.85rem;
      padding: 0.35rem 0.5rem;
    }
    .cdk-drag-preview {
      box-shadow: 0 12px 30px rgb(0 0 0 / 0.25);
      border-radius: 10px;
    }
    .cdk-drag-placeholder {
      opacity: 0.35;
    }
    .cdk-drag-animating,
    .grid.cdk-drop-list-dragging .tile:not(.cdk-drag-placeholder) {
      transition: transform 0.25s cubic-bezier(0, 0, 0.2, 1);
    }
    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .details {
        position: static;
      }
    }
  `,
})
export class AlbumEditor implements OnInit {
  /** "new", or the album's id (from the address). */
  readonly id = input.required<string>();

  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  private readonly router = inject(Router);
  protected readonly message = toastChannel();
  protected readonly accept = ACCEPT;

  protected readonly draft = signal<Draft>(blankDraft());
  protected readonly photos = signal<PhotoEdit[]>([]);
  protected readonly categories = signal<string[]>([]);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly picking = signal(false);
  protected readonly uploading = signal(0);
  protected readonly uploaded = signal(0);
  protected readonly uploadTotal = signal(0);
  protected readonly savedSlug = signal('');
  protected readonly savedPublished = signal(false);
  protected readonly isNew = computed(() => this.id() === 'new');
  protected readonly autoSlug = computed(() => slugify(this.draft().title));
  private nextKey = 1;

  constructor() {
    inject(Title).setTitle('Album | Admin');
  }

  ngOnInit(): void {
    void this.load();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(e: BeforeUnloadEvent) {
    if (this.dirty()) e.preventDefault();
  }

  canLeave() {
    return (
      !this.dirty() || confirm('You have unsaved changes to this album. Leave without saving?')
    );
  }

  private async load() {
    try {
      const list = await this.api.galleryAlbums();
      this.categories.set(
        [...new Set(list.albums.flatMap((a) => (a.category ? [a.category] : [])))].sort(),
      );
      if (!this.isNew()) this.apply(await this.api.galleryAlbum(Number(this.id())));
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  private apply(a: AlbumDetail) {
    this.cache.add(a.cover, ...a.photos.map((p) => p.media));
    this.draft.set({
      title: a.title,
      slug: a.slug,
      description: a.description ?? '',
      category: a.category ?? '',
      takenOn: a.takenOn ?? '',
      coverImageId: a.coverImageId,
      isPublished: a.isPublished,
      isFeatured: a.isFeatured,
      sortOrder: a.sortOrder,
    });
    this.photos.set(
      a.photos.map((p) => ({ key: this.nextKey++, mediaId: p.mediaId, caption: p.caption ?? '' })),
    );
    this.savedSlug.set(a.slug);
    this.savedPublished.set(a.isPublished);
    this.dirty.set(false);
  }

  protected patch(change: Partial<Draft>) {
    this.draft.update((d) => ({ ...d, ...change }));
    this.dirty.set(true);
  }

  protected media(id: number): MediaView | null {
    return this.cache.get(id);
  }

  protected isCover(p: PhotoEdit) {
    const cover = this.draft().coverImageId;
    return cover ? p.mediaId === cover : this.photos()[0]?.key === p.key;
  }

  protected setCover(p: PhotoEdit) {
    this.patch({ coverImageId: p.mediaId });
  }

  protected setCaption(i: number, caption: string) {
    this.photos.update((list) => list.map((p, j) => (j === i ? { ...p, caption } : p)));
    this.dirty.set(true);
  }

  protected removePhoto(i: number) {
    const gone = this.photos()[i];
    this.photos.update((list) => list.filter((_, j) => j !== i));
    if (
      gone &&
      this.draft().coverImageId === gone.mediaId &&
      !this.photos().some((p) => p.mediaId === gone.mediaId)
    )
      this.patch({ coverImageId: null });
    this.dirty.set(true);
  }

  protected drop(e: CdkDragDrop<unknown>) {
    if (e.previousIndex === e.currentIndex) return;
    this.photos.update((list) => {
      const copy = [...list];
      moveItemInArray(copy, e.previousIndex, e.currentIndex);
      return copy;
    });
    this.dirty.set(true);
  }

  protected addPicked(m: MediaView) {
    this.cache.add(m);
    this.addPhotos([m]);
    this.message.set({ kind: 'success', text: `Added ${m.originalName}.` });
  }

  private addPhotos(items: MediaView[]) {
    this.photos.update((list) => [
      ...list,
      ...items.map((m) => ({ key: this.nextKey++, mediaId: m.id, caption: '' })),
    ]);
    this.dirty.set(true);
  }

  /** Uploads the chosen photos to the media library (folder "Gallery"), two at a time, and adds each to the album. */
  protected async upload(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const files = [...(inputEl.files ?? [])];
    inputEl.value = '';
    if (!files.length) return;
    this.error.set('');
    this.uploadTotal.update((n) => n + files.length);
    this.uploading.update((n) => n + files.length);
    const alt = this.draft().title.trim();
    const failed: string[] = [];
    const queue = [...files];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        try {
          const m = await this.api.upload(file, {
            folder: 'Gallery',
            ...(alt ? { altText: alt } : {}),
          });
          this.cache.add(m);
          this.addPhotos([m]);
        } catch (err) {
          failed.push(`${file.name}: ${errorMessage(err)}`);
        } finally {
          this.uploading.update((n) => n - 1);
          this.uploaded.update((n) => n + 1);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (!this.uploading()) {
      this.uploaded.set(0);
      this.uploadTotal.set(0);
    }
    if (failed.length) this.error.set(`Some photos could not be uploaded. ${failed.join(' ')}`);
    else
      this.message.set({
        kind: 'success',
        text: `${files.length} ${files.length === 1 ? 'photo' : 'photos'} uploaded. Save the album to keep them in it.`,
      });
  }

  async save() {
    const d = this.draft();
    this.saving.set(true);
    this.error.set('');
    try {
      const saved = await this.api.saveGalleryAlbum(this.isNew() ? null : Number(this.id()), {
        title: d.title,
        slug: d.slug.trim(),
        description: d.description.trim() || null,
        category: d.category.trim() || null,
        takenOn: d.takenOn || null,
        coverImageId:
          d.coverImageId && this.photos().some((p) => p.mediaId === d.coverImageId)
            ? d.coverImageId
            : null,
        isPublished: d.isPublished,
        isFeatured: d.isFeatured,
        sortOrder: Number(d.sortOrder) || 0,
        photos: this.photos().map((p) => ({
          mediaId: p.mediaId,
          caption: p.caption.trim() || null,
        })),
      });
      this.apply(saved);
      this.message.set({
        kind: 'success',
        text: saved.isPublished
          ? 'Album saved. It is on the website.'
          : 'Album saved. It is hidden from the website.',
      });
      if (this.isNew())
        await this.router.navigate(['/admin/gallery', saved.id], { replaceUrl: true });
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    if (
      !confirm(
        `Delete the album "${this.draft().title}"? Its photos stay in the media library. This cannot be undone.`,
      )
    )
      return;
    try {
      await this.api.deleteGalleryAlbum(Number(this.id()));
      this.dirty.set(false);
      this.message.set({ kind: 'success', text: 'Album deleted.' });
      await this.router.navigate(['/admin/gallery']);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

function blankDraft(): Draft {
  return {
    title: '',
    slug: '',
    description: '',
    category: '',
    takenOn: '',
    coverImageId: null,
    isPublished: true,
    isFeatured: false,
    sortOrder: 0,
  };
}

/** Same rule as the API: "Graduation 2026!" -> "graduation-2026". */
function slugify(input: string) {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

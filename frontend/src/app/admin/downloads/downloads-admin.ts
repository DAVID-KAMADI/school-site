import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import type { MediaView } from '../../core/models';
import { AdminApi, type DownloadCategoryRow, type DownloadRow, type PageIntroEdit } from '../api';
import { MediaField } from '../fields/media-field';
import { PageIntroEditor } from '../fields/page-intro-editor';
import { MediaCache } from '../media/media-cache';
import { toastChannel } from '../toast';

/** Deadlines are entered and shown in the institute's time zone, wherever the editor is. */
const ZONE = 'Africa/Nairobi';
const OFFSET = '+03:00';
const dateIn = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeIn = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const shown = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const shownTime = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: true });

const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.jpg,.jpeg,.png,.webp';
const TYPE_NAMES: Record<string, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' };

interface DocEdit {
  id?: number;
  categoryId: number;
  title: string;
  reference: string;
  summary: string;
  mediaId: number | null;
  publishedOn: string;
  hasDeadline: boolean;
  closesOn: string;
  closesTime: string;
  isPublished: boolean;
  isPinned: boolean;
}

interface CategoryEdit {
  id?: number;
  name: string;
  slug: string;
  description: string;
}

/**
 * Admin → Downloads: tenders, job adverts, forms and other documents visitors can download from
 * the website's Downloads page (/downloads). Files are uploaded right here (they also go into the media library).
 */
@Component({
  selector: 'app-downloads-admin',
  imports: [FormsModule, MediaField, PageIntroEditor],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Downloads</h1>
        <p class="a-muted">
          Tenders, job adverts, forms and other documents for visitors to download from the
          <a href="/downloads" target="_blank" rel="noopener">Downloads page</a>. Give tenders and job adverts a
          closing date: after it they move to a “Closed” list on the website automatically.
        </p>
      </div>
      <div class="a-toolbar">
        <button class="a-btn" type="button" (click)="openCategories()">Categories</button>
        <button class="a-btn a-btn--primary" type="button" (click)="edit()" [disabled]="!categories().length">+ Add document</button>
      </div>
    </div>

    @if (page(); as p) {
      <app-page-intro-editor [value]="p" [saver]="savePage" viewUrl="/downloads" />
    }

    @if (loaded()) {
      <div class="filters">
        <div class="chips" role="group" aria-label="Show documents in">
          <button type="button" class="chip" [class.chip--on]="filter() === null" [attr.aria-pressed]="filter() === null" (click)="filter.set(null)">
            All <span>{{ items().length }}</span>
          </button>
          @for (c of categories(); track c.id) {
            <button type="button" class="chip" [class.chip--on]="filter() === c.id" [attr.aria-pressed]="filter() === c.id" (click)="filter.set(c.id)">
              {{ c.name }} <span>{{ countIn(c.id) }}</span>
            </button>
          }
        </div>
        <input class="a-input search" type="search" placeholder="Search title or reference" aria-label="Search documents" [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      @if (shownItems().length) {
        <div class="a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Posted</th>
                <th>Closing date</th>
                <th>On the website</th>
                <th><span class="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (d of shownItems(); track d.id) {
                <tr [class.row--hidden]="!d.isPublished">
                  <td>
                    <div class="doc">
                      <span class="type" [attr.data-type]="typeOf(d.file)">{{ short(d.file) }}</span>
                      <div class="doc__text">
                        <strong>{{ d.title }}</strong>
                        <span class="a-small a-muted">
                          @if (d.reference) {
                            Ref: {{ d.reference }} ·
                          }
                          @if (d.file) {
                            {{ d.file.originalName }} · {{ size(d.file.sizeBytes) }}
                          } @else {
                            <span class="a-error">File missing from the media library</span>
                          }
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>{{ categoryName(d.categoryId) }}</td>
                  <td class="nowrap">{{ date(d.publishedOn) }}</td>
                  <td class="nowrap">
                    @if (d.closesAt) {
                      {{ dateTime(d.closesAt) }}
                      @if (d.isClosed) {
                        <span class="a-badge">Closed</span>
                      } @else {
                        <span class="a-badge a-badge--live">Open</span>
                      }
                    } @else {
                      <span class="a-muted">—</span>
                    }
                  </td>
                  <td>
                    @if (d.isPublished) {
                      <span class="a-badge a-badge--live">Shown</span>
                    } @else {
                      <span class="a-badge">Hidden</span>
                    }
                    @if (d.isPinned) {
                      <span class="a-badge pin">Important</span>
                    }
                  </td>
                  <td class="nowrap actions">
                    <button class="a-btn a-btn--sm" type="button" (click)="edit(d)">Edit</button>
                    @if (d.file) {
                      <a class="a-btn a-btn--sm" [href]="d.file.url" target="_blank" rel="noopener">Open file</a>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="a-panel a-empty">
          @if (query()) {
            <p>No document matches “{{ query() }}”.</p>
          } @else if (filter() !== null) {
            <p>No documents in {{ categoryName(filter()!) }} yet.</p>
            <button class="a-btn a-btn--primary" type="button" (click)="edit()">+ Add document</button>
          } @else {
            <p>No documents yet. Add a tender, a job advert or a form for visitors to download.</p>
            <button class="a-btn a-btn--primary" type="button" (click)="edit()" [disabled]="!categories().length">+ Add document</button>
          }
        </div>
      }
    }

    @if (doc(); as e) {
      <div class="a-modal-backdrop" (click)="doc.set(null)">
        <form
          class="a-modal a-stack"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="e.id ? 'Edit document' : 'Add document'"
          (click)="$event.stopPropagation()"
          (ngSubmit)="save()"
        >
          <h2>{{ e.id ? 'Edit document' : 'Add a document' }}</h2>
          @if (error()) {
            <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
          }

          <div class="a-field">
            <span class="a-label">File</span>
            @if (fileOf(e); as f) {
              <div class="file">
                <span class="type" [attr.data-type]="typeOf(f)">{{ short(f) }}</span>
                <div class="doc__text">
                  <strong>{{ f.originalName }}</strong>
                  <span class="a-small a-muted">{{ typeOf(f) }} · {{ size(f.sizeBytes) }}</span>
                </div>
                <div class="a-toolbar">
                  <a class="a-btn a-btn--sm" [href]="f.url" target="_blank" rel="noopener">Open</a>
                  <label class="a-btn a-btn--sm">
                    Replace
                    <input class="visually-hidden" type="file" [accept]="accept" (change)="upload($event, e)" />
                  </label>
                </div>
              </div>
            } @else {
              <label class="drop" [class.drop--busy]="uploading()" (dragover)="$event.preventDefault()" (drop)="dropped($event, e)">
                <input class="visually-hidden" type="file" [accept]="accept" (change)="upload($event, e)" [disabled]="uploading()" />
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
                <strong>{{ uploading() ? 'Uploading…' : 'Click to upload a file, or drop it here' }}</strong>
                <span class="a-small a-muted">PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or a JPG/PNG image, up to 25 MB.</span>
              </label>
              <div class="pick">
                <span class="a-small a-muted">Or use a file already in the media library:</span>
                <app-media-field [(value)]="e.mediaId" kind="document" />
              </div>
            }
          </div>

          <div class="a-row">
            <label class="a-field">
              <span>Category</span>
              <select class="a-select" name="categoryId" [(ngModel)]="e.categoryId">
                @for (c of categories(); track c.id) {
                  <option [ngValue]="c.id">{{ c.name }}</option>
                }
              </select>
            </label>
            <label class="a-field">
              <span>Reference number <small class="a-muted">(optional)</small></span>
              <input class="a-input" name="reference" maxlength="80" placeholder="e.g. RCI/T/004/2026" [(ngModel)]="e.reference" />
            </label>
          </div>
          <label class="a-field">
            <span>Title</span>
            <input class="a-input" name="title" maxlength="200" required placeholder="e.g. Supply and delivery of laboratory equipment" [(ngModel)]="e.title" />
          </label>
          <label class="a-field">
            <span>Short description <small class="a-muted">(optional: who it is for, how to apply or submit)</small></span>
            <textarea class="a-textarea" name="summary" rows="3" maxlength="1000" [(ngModel)]="e.summary"></textarea>
          </label>

          <div class="a-row">
            <label class="a-field">
              <span>Posted on</span>
              <input class="a-input" type="date" name="publishedOn" required [(ngModel)]="e.publishedOn" />
            </label>
            <div class="a-field">
              <span class="a-label">Closing date</span>
              <label class="a-check">
                <input type="checkbox" name="hasDeadline" [(ngModel)]="e.hasDeadline" />
                Has a closing date (tenders, job adverts)
              </label>
            </div>
          </div>
          @if (e.hasDeadline) {
            <div class="a-row">
              <label class="a-field">
                <span>Closes on</span>
                <input class="a-input" type="date" name="closesOn" required [(ngModel)]="e.closesOn" />
              </label>
              <label class="a-field">
                <span>At (Kenya time)</span>
                <input class="a-input" type="time" name="closesTime" required [(ngModel)]="e.closesTime" />
              </label>
            </div>
            <p class="a-small a-muted">The website shows a countdown, then moves it to “Closed” at this time. It stays downloadable there for reference.</p>
          }

          <label class="a-check">
            <input type="checkbox" name="isPinned" [(ngModel)]="e.isPinned" />
            Mark as important (kept at the top of its list)
          </label>
          <label class="a-check">
            <input type="checkbox" name="isPublished" [(ngModel)]="e.isPublished" />
            Show on the website
          </label>

          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="saving() || uploading()">Save</button>
            <button class="a-btn" type="button" (click)="doc.set(null)">Cancel</button>
            @if (e.id) {
              <button class="a-btn a-btn--danger" type="button" (click)="remove(e)">Delete</button>
            }
          </div>
        </form>
      </div>
    }

    @if (catsOpen()) {
      <div class="a-modal-backdrop" (click)="catsOpen.set(false)">
        <div class="a-modal a-stack" role="dialog" aria-modal="true" aria-label="Categories" (click)="$event.stopPropagation()">
          <div class="a-toolbar a-toolbar--spread">
            <h2>Categories</h2>
            <button class="a-btn a-btn--sm" type="button" (click)="catsOpen.set(false)">Close</button>
          </div>
          <p class="a-small a-muted">
            Shown as tabs on the Downloads page, in this order. Each has its own address you can add to the main
            menu in Admin → Menus, e.g. <code>/downloads/tenders</code>.
          </p>
          @if (error() && !category()) {
            <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
          }
          <ul class="cats">
            @for (c of categories(); track c.id; let i = $index; let last = $last) {
              <li>
                <div class="doc__text">
                  <strong>{{ c.name }}</strong>
                  <span class="a-small a-muted">/downloads/{{ c.slug }} · {{ countIn(c.id) }} {{ countIn(c.id) === 1 ? 'document' : 'documents' }}</span>
                </div>
                <div class="a-toolbar">
                  <button class="a-btn a-btn--sm a-btn--icon" type="button" (click)="moveCategory(i, -1)" [disabled]="i === 0" aria-label="Move up" title="Move up">↑</button>
                  <button class="a-btn a-btn--sm a-btn--icon" type="button" (click)="moveCategory(i, 1)" [disabled]="last" aria-label="Move down" title="Move down">↓</button>
                  <button class="a-btn a-btn--sm" type="button" (click)="editCategory(c)">Edit</button>
                </div>
              </li>
            }
          </ul>
          @if (category(); as c) {
            <form class="a-panel a-stack cat-form" (ngSubmit)="saveCategory()">
              <h3>{{ c.id ? 'Edit category' : 'New category' }}</h3>
              @if (error()) {
                <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
              }
              <div class="a-row">
                <label class="a-field">
                  <span>Name</span>
                  <input class="a-input" name="name" maxlength="80" required placeholder="e.g. Scholarships" [(ngModel)]="c.name" />
                </label>
                <label class="a-field">
                  <span>Web address <small class="a-muted">(optional)</small></span>
                  <input class="a-input" name="slug" maxlength="90" placeholder="made from the name" [(ngModel)]="c.slug" />
                </label>
              </div>
              <label class="a-field">
                <span>Description <small class="a-muted">(optional, shown at the top of the category)</small></span>
                <input class="a-input" name="description" maxlength="300" [(ngModel)]="c.description" />
              </label>
              <div class="a-toolbar">
                <button class="a-btn a-btn--primary" type="submit" [disabled]="saving()">Save</button>
                <button class="a-btn" type="button" (click)="category.set(null)">Cancel</button>
                @if (c.id) {
                  <button class="a-btn a-btn--danger" type="button" (click)="removeCategory(c)">Delete category</button>
                }
              </div>
            </form>
          } @else {
            <div><button class="a-btn" type="button" (click)="editCategory()">+ New category</button></div>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .head { align-items: flex-start; gap: 1rem; margin-bottom: 1rem; }
    .head p { max-width: 60rem; }
    .filters { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: space-between; margin: 1rem 0; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .chip {
      display: inline-flex; gap: 0.4rem; align-items: center; padding: 0.35rem 0.8rem; font: inherit; font-size: 0.86rem; font-weight: 600;
      background: #fff; border: 1px solid var(--a-line); border-radius: 999px; cursor: pointer; color: var(--a-text);
    }
    .chip span { color: var(--a-muted); font-weight: 500; }
    .chip--on { background: var(--a-primary); border-color: var(--a-primary); color: #fff; }
    .chip--on span { color: rgb(255 255 255 / 0.8); }
    .search { max-width: 18rem; }
    .doc, .file { display: flex; gap: 0.75rem; align-items: center; min-width: 0; }
    .doc__text { display: grid; gap: 0.1rem; min-width: 0; }
    .doc__text strong { overflow-wrap: anywhere; }
    .file { padding: 0.75rem; border: 1px solid var(--a-line); border-radius: var(--a-radius-sm); background: #f8fafc; }
    .file .doc__text { flex: 1; }
    .type {
      --c: #5b6676; flex: none; display: grid; place-items: center; width: 2.4rem; height: 2.8rem; border-radius: 5px;
      background: color-mix(in srgb, var(--c) 12%, #fff); border: 1px solid color-mix(in srgb, var(--c) 40%, #fff);
      color: var(--c); font-size: 0.66rem; font-weight: 800; letter-spacing: 0.03em;
    }
    .type[data-type='PDF'] { --c: #c62828; }
    .type[data-type='Word'] { --c: #1e5bb8; }
    .type[data-type='Excel'] { --c: #1d7a45; }
    .type[data-type='PowerPoint'] { --c: #c4501b; }
    .type[data-type='Image'] { --c: #6b4fbb; }
    .nowrap { white-space: nowrap; }
    .actions { text-align: right; }
    .actions .a-btn + .a-btn { margin-left: 0.3rem; }
    .row--hidden td { color: var(--a-muted); }
    .pin { background: var(--a-accent-soft); color: var(--a-accent-text); margin-left: 0.25rem; }
    .drop {
      display: grid; justify-items: center; gap: 0.3rem; padding: 1.4rem 1rem; text-align: center; cursor: pointer;
      border: 2px dashed var(--a-line-strong); border-radius: var(--a-radius-sm); background: #f8fafc; transition: border-color 0.15s, background-color 0.15s;
    }
    .drop:hover, .drop:focus-within { border-color: var(--a-primary); background: var(--a-primary-soft); }
    .drop--busy { opacity: 0.7; cursor: progress; }
    .drop svg { width: 1.8rem; height: 1.8rem; fill: none; stroke: var(--a-primary); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .pick { display: grid; gap: 0.35rem; margin-top: 0.6rem; }
    .cats { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
    .cats li { display: flex; gap: 0.75rem; align-items: center; justify-content: space-between; padding: 0.55rem 0.75rem; border: 1px solid var(--a-line); border-radius: var(--a-radius-sm); }
    .cat-form h3 { margin: 0; font-size: 1rem; }
  `,
})
export class DownloadsAdmin {
  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  protected readonly message = toastChannel();
  protected readonly accept = ACCEPT;

  protected readonly page = signal<PageIntroEdit | null>(null);
  protected readonly categories = signal<DownloadCategoryRow[]>([]);
  protected readonly items = signal<DownloadRow[]>([]);
  protected readonly loaded = signal(false);
  protected readonly filter = signal<number | null>(null);
  protected readonly query = signal('');
  protected readonly doc = signal<DocEdit | null>(null);
  protected readonly catsOpen = signal(false);
  protected readonly category = signal<CategoryEdit | null>(null);
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly error = signal('');

  protected readonly shownItems = computed(() => {
    const f = this.filter();
    const q = this.query().trim().toLowerCase();
    return this.items().filter(
      (d) =>
        (f === null || d.categoryId === f) &&
        (!q || [d.title, d.reference, d.file?.originalName].some((v) => v?.toLowerCase().includes(q))),
    );
  });

  protected readonly savePage = async (v: PageIntroEdit) => this.page.set(await this.api.saveDownloadsPage(v));

  constructor() {
    inject(Title).setTitle('Downloads | Admin');
    void this.load();
  }

  private async load() {
    try {
      const r = await this.api.downloads();
      this.cache.add(...r.items.map((d) => d.file));
      this.page.set(r.page);
      this.categories.set(r.categories);
      this.items.set(r.items);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.loaded.set(true);
    }
  }

  protected countIn(categoryId: number) {
    return this.items().filter((d) => d.categoryId === categoryId).length;
  }

  protected categoryName(id: number) {
    return this.categories().find((c) => c.id === id)?.name ?? '';
  }

  protected fileOf(e: DocEdit): MediaView | null {
    return this.cache.get(e.mediaId);
  }

  protected typeOf(m: MediaView | null): string {
    if (!m) return '';
    if (m.kind === 'image') return 'Image';
    const ext = (m.url.split('.').pop() ?? '').toLowerCase();
    return TYPE_NAMES[ext] ?? ext.toUpperCase();
  }

  protected short(m: MediaView | null) {
    const t = this.typeOf(m);
    return ({ PDF: 'PDF', Word: 'DOC', Excel: 'XLS', PowerPoint: 'PPT', Image: 'IMG' } as Record<string, string>)[t] ?? (t || '?');
  }

  protected size(bytes: number) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  protected date(iso: string) {
    return shown.format(new Date(`${iso}T12:00:00${OFFSET}`));
  }

  protected dateTime(iso: string) {
    const d = new Date(iso);
    return `${shown.format(d)}, ${shownTime.format(d)}`;
  }

  // ---------- Documents ----------

  protected edit(d?: DownloadRow) {
    this.error.set('');
    const today = dateIn.format(new Date());
    if (d) {
      this.cache.add(d.file);
      const closes = d.closesAt ? new Date(d.closesAt) : null;
      this.doc.set({
        id: d.id,
        categoryId: d.categoryId,
        title: d.title,
        reference: d.reference ?? '',
        summary: d.summary ?? '',
        mediaId: d.mediaId,
        publishedOn: d.publishedOn,
        hasDeadline: !!closes,
        closesOn: closes ? dateIn.format(closes) : '',
        closesTime: closes ? timeIn.format(closes) : '10:00',
        isPublished: d.isPublished,
        isPinned: d.isPinned,
      });
      return;
    }
    const categoryId = this.filter() ?? this.categories()[0]?.id;
    if (!categoryId) return;
    const slug = this.categories().find((c) => c.id === categoryId)?.slug;
    this.doc.set({
      categoryId,
      title: '',
      reference: '',
      summary: '',
      mediaId: null,
      publishedOn: today,
      hasDeadline: slug === 'tenders' || slug === 'jobs',
      closesOn: '',
      closesTime: '10:00',
      isPublished: true,
      isPinned: false,
    });
  }

  protected dropped(event: DragEvent, e: DocEdit) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.send(file, e);
  }

  protected upload(event: Event, e: DocEdit) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.send(file, e);
  }

  /** Uploads to the media library (folder "Downloads") and uses the file for this document. */
  private async send(file: File, e: DocEdit) {
    if (file.size > 25 * 1024 * 1024) return this.error.set('That file is larger than 25 MB. Make it smaller (e.g. save the PDF at a lower quality) and try again.');
    this.uploading.set(true);
    this.error.set('');
    try {
      const isImage = file.type.startsWith('image/');
      const m = await this.api.upload(file, { folder: 'Downloads', altText: isImage ? e.title || file.name.replace(/\.[^.]+$/, '') : undefined });
      this.cache.add(m);
      this.doc.update((d) => {
        if (!d) return d;
        // A new document takes its title from the file name until one is typed.
        const title = d.title.trim() ? d.title : file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        return { ...d, mediaId: m.id, title };
      });
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.uploading.set(false);
    }
  }

  async save() {
    const e = this.doc();
    if (!e) return;
    if (!e.mediaId) return this.error.set('Upload the file first.');
    if (e.hasDeadline && (!e.closesOn || !e.closesTime)) return this.error.set('Enter the closing date and time, or untick “Has a closing date”.');
    await this.run(async () => {
      await this.api.saveDownload(e.id ?? null, {
        categoryId: Number(e.categoryId),
        title: e.title,
        reference: e.reference.trim(),
        summary: e.summary.trim(),
        mediaId: e.mediaId,
        publishedOn: e.publishedOn,
        closesAt: e.hasDeadline ? new Date(`${e.closesOn}T${e.closesTime}:00${OFFSET}`).toISOString() : '',
        isPublished: e.isPublished,
        isPinned: e.isPinned,
      });
      this.doc.set(null);
      this.message.set({ kind: 'success', text: `“${e.title}” saved.` });
    });
  }

  async remove(e: DocEdit) {
    if (!e.id || !confirm(`Delete “${e.title}” from the Downloads page? To take it down for now, untick “Show on the website” instead.`)) return;
    await this.run(async () => {
      await this.api.deleteDownload(e.id!);
      this.doc.set(null);
      this.message.set({ kind: 'success', text: `“${e.title}” deleted. The file stays in the media library.` });
    });
  }

  // ---------- Categories ----------

  protected openCategories() {
    this.error.set('');
    this.category.set(null);
    this.catsOpen.set(true);
  }

  protected editCategory(c?: DownloadCategoryRow) {
    this.error.set('');
    this.category.set(c ? { id: c.id, name: c.name, slug: c.slug, description: c.description ?? '' } : { name: '', slug: '', description: '' });
  }

  async saveCategory() {
    const c = this.category();
    if (!c) return;
    await this.run(async () => {
      await this.api.saveDownloadCategory(c.id ?? null, { name: c.name, slug: c.slug.trim(), description: c.description.trim() });
      this.category.set(null);
      this.message.set({ kind: 'success', text: `Category “${c.name}” saved.` });
    });
  }

  async removeCategory(c: CategoryEdit) {
    if (!c.id || !confirm(`Delete the category “${c.name}”?`)) return;
    await this.run(async () => {
      await this.api.deleteDownloadCategory(c.id!);
      this.category.set(null);
      if (this.filter() === c.id) this.filter.set(null);
      this.message.set({ kind: 'success', text: `Category “${c.name}” deleted.` });
    });
  }

  async moveCategory(index: number, step: number) {
    const list = [...this.categories()];
    const [moved] = list.splice(index, 1);
    list.splice(index + step, 0, moved);
    this.categories.set(list);
    await this.run(() => this.api.orderDownloadCategories(list.map((c) => c.id)).then(() => undefined));
  }

  private async run(fn: () => Promise<void>) {
    this.saving.set(true);
    this.error.set('');
    try {
      await fn();
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}

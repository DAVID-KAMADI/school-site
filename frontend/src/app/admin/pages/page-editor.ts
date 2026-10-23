import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, HostListener, computed, inject, input, signal, type OnDestroy, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink, type CanDeactivateFn } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import type { ApiError, Block } from '../../core/models';
import { PageBody } from '../../shared/page-body';
import { AdminApi, type EditorBlock, type PageDetail, type PageSummary, type Revision, type TranslationDetail, type TranslationSummary } from '../api';
import { FieldList } from '../fields/field-list';
import { MediaField } from '../fields/media-field';
import { MediaCache } from '../media/media-cache';
import { BLOCK_DEFS, BLOCK_DEF_MAP, type BlockDef } from './block-defs';

interface LocalBlock extends EditorBlock {
  uid: number;
}

let nextUid = 1;

@Component({
  selector: 'app-page-editor',
  imports: [FormsModule, RouterLink, DatePipe, NgTemplateOutlet, FieldList, MediaField, PageBody],
  templateUrl: './page-editor.html',
  styleUrl: './page-editor.scss',
})
export class PageEditor implements OnInit, OnDestroy {
  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);

  /** Route parameter. */
  readonly id = input.required<string>();

  protected readonly page = signal<PageDetail | null>(null);
  protected readonly blocks = signal<LocalBlock[]>([]);
  protected readonly allPages = signal<PageSummary[]>([]);
  protected readonly revisions = signal<Revision[]>([]);
  protected readonly tab = signal<'content' | 'settings' | 'history'>('content');
  protected readonly device = signal<'desktop' | 'mobile'>('desktop');
  protected readonly expanded = signal<Set<number>>(new Set());
  protected readonly palette = signal<number | null>(null);
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  protected readonly version = signal(0);
  protected readonly message = signal<{ kind: 'success' | 'error' | 'warning' | 'info'; text: string; list?: string[] } | null>(null);
  /** Server validation errors per block index, keyed by field path. */
  protected readonly blockErrors = signal<Record<number, Record<string, string>>>({});
  protected readonly lockedBy = signal<PageDetail['lockedBy']>(null);
  /** Other languages this page can be translated into (empty while the site is English only). */
  protected readonly translations = signal<TranslationSummary[]>([]);
  /** Language being edited: "en" for the page itself, otherwise its translation. */
  protected readonly lang = signal('en');
  protected readonly translation = signal<TranslationDetail | null>(null);

  // Editable page fields
  protected title = '';
  protected seoTitle = '';
  protected metaDescription = '';
  protected socialImageId: number | null = null;
  protected template: PageDetail['template'] = 'standard';
  // Settings fields
  protected slug = '';
  protected parentId: number | null = null;
  protected visibility: PageDetail['visibility'] = 'public';
  protected publishAt = '';
  protected unpublishAt = '';

  protected readonly defs = BLOCK_DEFS;
  protected readonly cacheMap = this.cache.map;
  protected readonly previewBlocks = computed<Block[]>(() => {
    this.version();
    return this.blocks()
      .filter((b) => !b.isHidden)
      .map((b) => ({ type: b.type, content: { ...b.content } }));
  });
  protected readonly previewTitle = computed(() => {
    this.version();
    return this.title;
  });
  protected readonly parentOptions = computed(() => {
    const id = Number(this.id());
    const all = this.allPages();
    const descendants = new Set<number>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of all) if (p.parentId !== null && descendants.has(p.parentId) && !descendants.has(p.id)) (descendants.add(p.id), (grew = true));
    }
    return all.filter((p) => !descendants.has(p.id)).sort((a, b) => a.path.localeCompare(b.path));
  });

  private lockTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    void this.load();
    this.lockTimer = setInterval(() => void this.refreshLock(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.lockTimer) clearInterval(this.lockTimer);
    void this.api.unlock(Number(this.id())).catch(() => undefined);
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(e: BeforeUnloadEvent) {
    if (this.dirty()) e.preventDefault();
  }

  @HostListener('window:keydown', ['$event'])
  protected shortcut(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.save();
    }
  }

  async load() {
    try {
      const [page, pages, translations] = await Promise.all([
        this.api.page(Number(this.id())),
        this.api.pages(),
        this.api.translations(Number(this.id())).catch(() => []),
      ]);
      this.allPages.set(pages);
      this.translations.set(translations);
      this.lang.set('en');
      this.translation.set(null);
      this.apply(page);
      await this.refreshLock();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  private apply(page: PageDetail) {
    this.page.set(page);
    this.cache.addMap(page.media);
    this.title = page.title;
    this.seoTitle = page.seoTitle ?? '';
    this.metaDescription = page.metaDescription ?? '';
    this.socialImageId = page.socialImageId;
    this.template = page.template;
    this.slug = page.slug;
    this.parentId = page.parentId;
    this.visibility = page.visibility;
    this.publishAt = toLocalInput(page.publishAt);
    this.unpublishAt = toLocalInput(page.unpublishAt);
    this.blocks.set(page.blocks.map((b) => ({ ...b, content: structuredClone(b.content), uid: nextUid++ })));
    this.blockErrors.set({});
    this.dirty.set(false);
    this.version.update((v) => v + 1);
    this.titleService.setTitle(`${page.title} | Edit page`);
  }

  private async refreshLock() {
    try {
      const res = await this.api.lock(Number(this.id()));
      this.lockedBy.set(res.lockedBy);
    } catch {
      /* lock is advisory */
    }
  }

  protected touch() {
    this.dirty.set(true);
    this.version.update((v) => v + 1);
  }

  // ---------- Languages ----------

  /** Opens the English page or one of its translations in the editor. */
  async switchLanguage(locale: string) {
    if (locale === this.lang() || this.busy()) return;
    if (this.dirty() && !confirm('You have unsaved changes. Switch language without saving?')) return;
    this.message.set(null);
    if (locale === 'en') {
      await this.load();
      return;
    }
    try {
      const t = await this.api.translation(Number(this.id()), locale);
      this.tab.set('content');
      this.lang.set(locale);
      this.applyTranslation(t);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  private applyTranslation(t: TranslationDetail) {
    this.translation.set(t);
    this.cache.addMap(t.media);
    this.title = t.title;
    this.seoTitle = t.seoTitle ?? '';
    this.metaDescription = t.metaDescription ?? '';
    this.blocks.set(t.blocks.map((b) => ({ ...b, content: structuredClone(b.content), uid: nextUid++ })));
    this.blockErrors.set({});
    this.dirty.set(!t.exists);
    this.version.update((v) => v + 1);
    this.translations.update((list) => list.map((l) => (l.locale === t.locale ? { ...l, ...pickSummary(t) } : l)));
    this.titleService.setTitle(`${t.title} (${t.name}) | Edit page`);
  }

  /** Replaces the translation draft with a fresh copy of the English page (not saved until Save draft). */
  protected copyFromEnglish() {
    const page = this.page();
    if (!page || !confirm('Replace this translation with a copy of the current English page? Save draft to keep it.')) return;
    this.title = page.title;
    this.seoTitle = page.seoTitle ?? '';
    this.metaDescription = page.metaDescription ?? '';
    this.blocks.set(page.blocks.map((b) => ({ ...b, id: undefined, content: structuredClone(b.content), uid: nextUid++ })));
    this.blockErrors.set({});
    this.touch();
  }

  async deleteTranslation() {
    const t = this.translation();
    if (!t || !confirm(`Delete the ${t.name} version of this page? Visitors choosing ${t.name} will see the English page.`)) return;
    try {
      await this.api.deleteTranslation(Number(this.id()), t.locale);
      this.dirty.set(false);
      await this.load();
      this.message.set({ kind: 'info', text: `The ${t.name} version was deleted.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  // ---------- Blocks ----------

  protected def(type: string): BlockDef | undefined {
    return BLOCK_DEF_MAP.get(type);
  }

  protected summary(b: LocalBlock): string {
    const c = b.content;
    const text = [c['heading'], c['title'], c['quote'], c['label'], c['caption']].find((v) => typeof v === 'string' && v.trim());
    if (text) return String(text);
    if (typeof c['html'] === 'string') return c['html'].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (Array.isArray(c['items'])) return `${c['items'].length} item(s)`;
    return '';
  }

  protected isExpanded(uid: number) {
    return this.expanded().has(uid);
  }

  protected toggle(uid: number, force?: boolean) {
    this.expanded.update((s) => {
      const n = new Set(s);
      if (force ?? !n.has(uid)) n.add(uid);
      else n.delete(uid);
      return n;
    });
  }

  protected addBlock(def: BlockDef, at: number) {
    const block: LocalBlock = { uid: nextUid++, type: def.type, isHidden: false, content: def.defaults() };
    this.blocks.update((list) => [...list.slice(0, at), block, ...list.slice(at)]);
    this.palette.set(null);
    this.toggle(block.uid, true);
    this.shiftErrors(at, 1);
    this.touch();
  }

  protected move(index: number, step: number) {
    const target = index + step;
    const list = this.blocks().slice();
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.blocks.set(list);
    this.blockErrors.set({});
    this.touch();
  }

  protected duplicate(index: number) {
    const src = this.blocks()[index];
    const copy: LocalBlock = { ...src, id: undefined, uid: nextUid++, content: structuredClone(src.content) };
    this.blocks.update((list) => [...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
    this.shiftErrors(index + 1, 1);
    this.touch();
  }

  protected remove(index: number) {
    const b = this.blocks()[index];
    if (!confirm(`Remove this ${this.def(b.type)?.label ?? b.type} block?`)) return;
    this.blocks.update((list) => list.filter((_, i) => i !== index));
    this.blockErrors.set({});
    this.touch();
  }

  protected toggleHidden(b: LocalBlock) {
    b.isHidden = !b.isHidden;
    this.blocks.update((l) => [...l]);
    this.touch();
  }

  private shiftErrors(from: number, by: number) {
    const cur = this.blockErrors();
    const next: Record<number, Record<string, string>> = {};
    for (const [k, v] of Object.entries(cur)) next[Number(k) >= from ? Number(k) + by : Number(k)] = v;
    this.blockErrors.set(next);
  }

  // ---------- Saving and workflow ----------

  async save(note?: string): Promise<boolean> {
    const page = this.page();
    if (!page || this.busy()) return false;
    this.busy.set(true);
    this.message.set(null);
    const t = this.translation();
    if (t) {
      try {
        const saved = await this.api.saveTranslation(page.id, t.locale, {
          title: this.title,
          seoTitle: this.seoTitle || null,
          metaDescription: this.metaDescription || null,
          blocks: this.blocks().map((b) => ({ type: b.type, isHidden: b.isHidden, content: b.content })),
        });
        const open = this.blocks().map((b, i) => (this.isExpanded(b.uid) ? i : -1)).filter((i) => i >= 0);
        this.applyTranslation(saved);
        this.expanded.set(new Set(open.map((i) => this.blocks()[i]?.uid).filter((u): u is number => !!u)));
        this.message.set({ kind: 'success', text: saved.isLive ? `Draft saved. Visitors still see the published ${saved.name} version until you publish.` : 'Draft saved.' });
        return true;
      } catch (err) {
        this.showSaveError(err);
        return false;
      } finally {
        this.busy.set(false);
      }
    }
    try {
      const saved = await this.api.saveContent(page.id, {
        title: this.title,
        template: this.template,
        seoTitle: this.seoTitle || null,
        metaDescription: this.metaDescription || null,
        socialImageId: this.socialImageId,
        blocks: this.blocks().map((b) => ({ type: b.type, isHidden: b.isHidden, content: b.content })),
        note,
      });
      const open = this.blocks().map((b, i) => (this.isExpanded(b.uid) ? i : -1)).filter((i) => i >= 0);
      this.apply(saved);
      this.expanded.set(new Set(open.map((i) => this.blocks()[i]?.uid).filter((u): u is number => !!u)));
      this.message.set({ kind: 'success', text: saved.isLive ? 'Draft saved. Visitors still see the published version until you publish.' : 'Draft saved.' });
      return true;
    } catch (err) {
      this.showSaveError(err);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private showSaveError(err: unknown) {
    const body = (err as HttpErrorResponse).error as ApiError | undefined;
    if (body?.code === 'INVALID_BLOCKS' && body.issues) {
      const errors: Record<number, Record<string, string>> = {};
      for (const issue of body.issues) (errors[issue.block] ??= {})[issue.path] = issue.message;
      this.blockErrors.set(errors);
      for (const index of Object.keys(errors)) {
        const uid = this.blocks()[Number(index)]?.uid;
        if (uid) this.toggle(uid, true);
      }
      this.message.set({
        kind: 'error',
        text: 'Some blocks need attention before saving:',
        list: body.issues.map((i) => `${this.def(i.type)?.label ?? i.type} (block ${i.block + 1}): ${i.path ? i.path + ' — ' : ''}${i.message}`),
      });
    } else {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async publish() {
    const page = this.page();
    if (!page) return;
    if (this.dirty() && !(await this.save())) return;
    this.busy.set(true);
    const t = this.translation();
    if (t) {
      try {
        const res = await this.api.publishTranslation(page.id, t.locale);
        this.applyTranslation(res.translation);
        this.message.set(
          res.warnings.length
            ? { kind: 'warning', text: `The ${t.name} version is published.`, list: res.warnings }
            : { kind: 'success', text: `Published. The ${t.name} version is live at ${res.translation.path}.` },
        );
      } catch (err) {
        this.message.set({ kind: 'error', text: errorMessage(err) });
      } finally {
        this.busy.set(false);
      }
      return;
    }
    try {
      const res = await this.api.publish(page.id);
      this.apply(res.page);
      this.message.set(
        res.warnings.length
          ? { kind: 'warning', text: 'Published. Worth fixing:', list: res.warnings }
          : { kind: 'success', text: 'Published. The page is live.' },
      );
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  async submit() {
    const page = this.page();
    if (!page) return;
    if (this.dirty() && !(await this.save())) return;
    try {
      this.apply(await this.api.submit(page.id));
      this.message.set({ kind: 'success', text: 'Sent for approval. A publisher will review and publish it.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async unpublish() {
    const page = this.page();
    const t = this.translation();
    if (page && t) {
      if (!confirm(`Take the ${t.name} version offline? Visitors choosing ${t.name} will see the English page.`)) return;
      try {
        this.applyTranslation(await this.api.unpublishTranslation(page.id, t.locale));
        this.message.set({ kind: 'info', text: `The ${t.name} version is offline. Your translation is kept as a draft.` });
      } catch (err) {
        this.message.set({ kind: 'error', text: errorMessage(err) });
      }
      return;
    }
    if (!page || !confirm('Take this page offline? Visitors will no longer see it.')) return;
    try {
      this.apply(await this.api.unpublish(page.id));
      this.message.set({ kind: 'info', text: 'The page is offline. Your content is kept as a draft.' });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async saveSettings() {
    const page = this.page();
    if (!page) return;
    this.busy.set(true);
    try {
      const body: Record<string, unknown> = { visibility: this.visibility };
      if (!page.isHome) Object.assign(body, { slug: this.slug.trim(), parentId: this.parentId });
      if (page.canPublish) Object.assign(body, { publishAt: fromLocalInput(this.publishAt), unpublishAt: fromLocalInput(this.unpublishAt) });
      const saved = await this.api.pageSettings(page.id, body);
      const keepBlocks = this.dirty();
      const blocks = this.blocks();
      this.apply(saved);
      if (keepBlocks) (this.blocks.set(blocks), this.dirty.set(true));
      this.message.set({ kind: 'success', text: `Settings saved. Address: ${saved.path}` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  async showHistory() {
    this.tab.set('history');
    const page = this.page();
    if (page) this.revisions.set(await this.api.revisions(page.id));
  }

  async restore(rev: Revision) {
    const page = this.page();
    if (!page || !confirm(`Load revision ${rev.revisionNumber} into the editor? It becomes the new draft; publish to make it live.`)) return;
    try {
      this.apply(await this.api.restoreRevision(page.id, rev.id));
      this.revisions.set(await this.api.revisions(page.id));
      this.message.set({ kind: 'success', text: `Revision ${rev.revisionNumber} restored as a draft.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async previewLink() {
    const page = this.page();
    if (!page) return;
    if (this.dirty() && !(await this.save())) return;
    try {
      const { url, expiresAt } = await this.api.previewLink(page.id);
      const full = `${location.origin}${url}`;
      await navigator.clipboard?.writeText(full).catch(() => undefined);
      this.message.set({ kind: 'info', text: `Preview link copied (valid until ${new Date(expiresAt).toLocaleString()}): ${full}` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async duplicatePage() {
    const page = this.page();
    if (!page) return;
    try {
      const copy = await this.api.duplicate(page.id);
      this.dirty.set(false);
      await this.router.navigate(['/admin/pages', copy.id]);
      await this.load();
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  async trashPage() {
    const page = this.page();
    if (!page || !confirm(`Move “${page.title}” to the trash? It can be restored for 30 days.`)) return;
    try {
      await this.api.trashPage(page.id);
      this.dirty.set(false);
      await this.router.navigateByUrl('/admin/pages');
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  canLeave(): boolean {
    return !this.dirty() || confirm('You have unsaved changes. Leave without saving?');
  }
}

export const unsavedChangesGuard: CanDeactivateFn<PageEditor> = (editor) => editor.canLeave();

function pickSummary(t: TranslationDetail): Partial<TranslationSummary> {
  const { exists, isLive, hasUnpublishedChanges, englishChanged, updatedAt, publishedAt } = t;
  return { exists, isLive, hasUnpublishedChanges, englishChanged, updatedAt, publishedAt };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

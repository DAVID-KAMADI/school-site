import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-url.interceptor';
import { AuthStore } from '../../core/auth';
import { AdminApi, type PageSummary } from '../api';

interface TreeRow extends PageSummary {
  depth: number;
}

/** All pages as an indented tree, with status, quick actions and the trash. */
@Component({
  selector: 'app-pages-list',
  imports: [RouterLink, FormsModule, DatePipe],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <h1>Pages</h1>
      @if (auth.can('pages.create')) {
        <button class="a-btn a-btn--primary" type="button" (click)="openCreate(null)">+ New page</button>
      }
    </div>
    @if (error()) {
      <div class="a-alert a-alert--error" role="alert">{{ error() }}</div>
    }

    <div class="a-table-wrap">
      <table class="a-table">
        <thead>
          <tr><th>Page</th><th>Status</th><th>Last changed</th><th><span class="visually-hidden">Actions</span></th></tr>
        </thead>
        <tbody>
          @for (p of rows(); track p.id) {
            <tr>
              <td>
                <div class="page-cell" [style.padding-left.rem]="p.depth * 1.5">
                  @if (p.canEdit) {
                    <a [routerLink]="['/admin/pages', p.id]" class="page-title">{{ p.title }}</a>
                  } @else {
                    <span class="page-title">{{ p.title }}</span>
                  }
                  <span class="a-small a-muted">{{ p.path }}</span>
                </div>
              </td>
              <td>
                @if (p.isLive) {
                  <span class="a-badge a-badge--live">Live</span>
                }
                @if (p.hasUnpublishedChanges) {
                  <span class="a-badge a-badge--changes">Unpublished changes</span>
                }
                @if (p.status === 'in_review') {
                  <span class="a-badge a-badge--review">Waiting for approval</span>
                }
                @if (!p.isLive && p.status === 'draft') {
                  <span class="a-badge">Draft</span>
                }
                @if (p.publishAt) {
                  <span class="a-badge">Scheduled {{ p.publishAt | date: 'd MMM, HH:mm' }}</span>
                }
                @if (p.visibility !== 'public') {
                  <span class="a-badge">{{ p.visibility }} only</span>
                }
              </td>
              <td class="a-small a-muted">{{ p.updatedAt | date: 'd MMM y, HH:mm' }}</td>
              <td class="actions">
                @if (p.isLive) {
                  <a class="a-btn a-btn--sm" [href]="p.path" target="_blank" rel="noopener">View</a>
                }
                @if (auth.can('pages.create')) {
                  <button class="a-btn a-btn--sm" type="button" (click)="openCreate(p.id)">+ Sub-page</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="a-empty">No pages yet.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (auth.can('pages.delete') && trash().length) {
      <section class="a-panel trash">
        <h2>Trash</h2>
        <p class="a-small a-muted">Deleted pages are removed for good after 30 days.</p>
        <ul>
          @for (t of trash(); track t.id) {
            <li>
              <strong>{{ t.title }}</strong> <span class="a-muted a-small">{{ t.path }} · deleted {{ t.deletedAt | date: 'd MMM' }}</span>
              <button class="a-btn a-btn--sm" type="button" (click)="restore(t.id)">Restore</button>
            </li>
          }
        </ul>
      </section>
    }

    @if (creating()) {
      <div class="a-modal-backdrop" (click)="creating.set(false)">
        <form class="a-modal a-stack" role="dialog" aria-modal="true" aria-labelledby="new-page-title" (click)="$event.stopPropagation()" (ngSubmit)="create()">
          <h2 id="new-page-title">New page</h2>
          <label class="a-field">
            <span>Title</span>
            <input class="a-input" name="title" required maxlength="200" [(ngModel)]="newTitle" autofocus />
            <span class="a-help">The web address is made from the title. You can change it later in Page settings.</span>
          </label>
          <label class="a-field">
            <span>Inside</span>
            <select class="a-select" name="parent" [(ngModel)]="newParent">
              <option [ngValue]="null">Top level</option>
              @for (p of rows(); track p.id) {
                @if (!p.path.includes('~')) {
                  <option [ngValue]="p.id">{{ '— '.repeat(p.depth) }}{{ p.title }}</option>
                }
              }
            </select>
          </label>
          <label class="a-field">
            <span>Layout</span>
            <select class="a-select" name="template" [(ngModel)]="newTemplate">
              <option value="standard">Standard page (title at top)</option>
              <option value="landing">Landing page (starts with your own hero)</option>
            </select>
          </label>
          <div class="a-toolbar">
            <button class="a-btn a-btn--primary" type="submit" [disabled]="!newTitle.trim() || busy()">Create page</button>
            <button class="a-btn" type="button" (click)="creating.set(false)">Cancel</button>
          </div>
        </form>
      </div>
    }
  `,
  styles: `
    .head { margin-bottom: 1rem; }
    .head h1 { margin: 0; }
    .page-cell { display: grid; }
    .page-title { font-weight: 650; }
    td .a-badge { margin: 0 0.25rem 0.25rem 0; }
    .actions { text-align: right; white-space: nowrap; }
    .actions .a-btn { margin-left: 0.3rem; }
    .trash { margin-top: 1.5rem; }
    .trash ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem; }
    .trash li { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
  `,
})
export class PagesList {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);

  protected readonly pages = signal<PageSummary[]>([]);
  protected readonly trash = signal<{ id: number; title: string; path: string; deletedAt: string }[]>([]);
  protected readonly error = signal('');
  protected readonly creating = signal(false);
  protected readonly busy = signal(false);
  protected newTitle = '';
  protected newParent: number | null = null;
  protected newTemplate = 'standard';

  /** Flat list ordered as a tree (parents before children). */
  protected readonly rows = computed<TreeRow[]>(() => {
    const all = this.pages();
    const children = new Map<number | null, PageSummary[]>();
    for (const p of all) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
    const out: TreeRow[] = [];
    const walk = (parent: number | null, depth: number) => {
      const list = (children.get(parent) ?? []).sort((a, b) => (a.path === '/' ? -1 : b.path === '/' ? 1 : a.title.localeCompare(b.title)));
      for (const p of list) {
        out.push({ ...p, depth });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  constructor() {
    inject(Title).setTitle('Pages | Admin');
    void this.load();
  }

  async load() {
    try {
      this.pages.set(await this.api.pages());
      if (this.auth.can('pages.delete')) this.trash.set(await this.api.trash());
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  openCreate(parentId: number | null) {
    this.newTitle = '';
    this.newParent = parentId;
    this.newTemplate = 'standard';
    this.creating.set(true);
  }

  async create() {
    this.busy.set(true);
    try {
      const page = await this.api.createPage({ title: this.newTitle.trim(), parentId: this.newParent, template: this.newTemplate });
      await this.router.navigate(['/admin/pages', page.id]);
    } catch (err) {
      this.error.set(errorMessage(err));
      this.creating.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  async restore(id: number) {
    try {
      await this.api.restorePage(id);
      await this.load();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }
}

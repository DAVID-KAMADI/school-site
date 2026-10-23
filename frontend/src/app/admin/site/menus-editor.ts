import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type MenuItemEdit, type PageSummary } from '../api';

interface MenuEdit {
  location: string;
  name: string;
  items: MenuItemEdit[];
}

const HELP: Record<string, string> = {
  main: 'The main navigation. Items with sub-items become dropdowns. Tick “Show as button” for actions such as Apply Now.',
  utility: 'Small links above the header (News, Events, Careers, Visit).',
  footer: 'Each top-level item becomes a footer column heading; its sub-items are the links under it.',
};

/** Edit the main, utility and footer menus. Links to pages follow the page if its address changes. */
@Component({
  selector: 'app-menus-editor',
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <h1>Menus</h1>
    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }
    @for (menu of menus(); track menu.location) {
      <section class="a-panel">
        <div class="a-toolbar a-toolbar--spread">
          <h2>{{ menu.name }}</h2>
          <button class="a-btn a-btn--primary" type="button" (click)="save(menu)">Save {{ menu.name.toLowerCase() }}</button>
        </div>
        <p class="a-help">{{ help[menu.location] }}</p>
        <ng-container *ngTemplateOutlet="itemsTpl; context: { $implicit: menu.items, depth: 1 }" />
      </section>
    }

    <ng-template #itemsTpl let-items let-depth="depth">
      <ol class="items">
        @for (item of items; track $index; let i = $index; let first = $first; let last = $last) {
          <li class="item">
            <div class="item__row">
              <input class="a-input label" [(ngModel)]="item.label" placeholder="Label" aria-label="Label" maxlength="100" />
              <select class="a-select kind" [ngModel]="item.pageId !== null ? 'page' : 'url'" (ngModelChange)="setKind(item, $event)" aria-label="Link type">
                <option value="page">Page</option>
                <option value="url">Web address</option>
              </select>
              @if (item.pageId !== null) {
                <select class="a-select target" [(ngModel)]="item.pageId" aria-label="Page">
                  @for (p of pages(); track p.id) {
                    <option [ngValue]="p.id">{{ p.title }} ({{ p.path }}){{ p.isLive ? '' : ' — not live' }}</option>
                  }
                </select>
              } @else {
                <input class="a-input target" [(ngModel)]="item.url" placeholder="/path or https://…" aria-label="Web address" maxlength="500" />
              }
            </div>
            <div class="item__row item__opts">
              <label class="a-check"><input type="checkbox" [(ngModel)]="item.isVisible" /> Visible</label>
              <label class="a-check"><input type="checkbox" [(ngModel)]="item.openInNewTab" /> New tab</label>
              @if (depth === 1) {
                <label class="a-check"><input type="checkbox" [(ngModel)]="item.isButton" /> Show as button</label>
              }
              <span class="spacer"></span>
              <button class="a-btn a-btn--sm a-btn--icon" type="button" [disabled]="first" (click)="move(items, i, -1)" aria-label="Move up">↑</button>
              <button class="a-btn a-btn--sm a-btn--icon" type="button" [disabled]="last" (click)="move(items, i, 1)" aria-label="Move down">↓</button>
              @if (depth < 3) {
                <button class="a-btn a-btn--sm" type="button" (click)="add(item.children)">+ Sub-item</button>
              }
              <button class="a-btn a-btn--sm a-btn--danger" type="button" (click)="items.splice(i, 1)">Remove</button>
            </div>
            @if (item.children.length) {
              <ng-container *ngTemplateOutlet="itemsTpl; context: { $implicit: item.children, depth: depth + 1 }" />
            }
          </li>
        }
      </ol>
      <button class="a-btn a-btn--sm" type="button" (click)="add(items)">+ Add item</button>
    </ng-template>
  `,
  styles: `
    .items { list-style: none; padding: 0; margin: 0.5rem 0; display: grid; gap: 0.5rem; }
    .items .items { margin-left: 1.5rem; padding-left: 0.75rem; border-left: 2px solid var(--a-line); }
    .item { border: 1px solid var(--a-line); border-radius: 8px; padding: 0.6rem; background: #fcfcfd; }
    .item__row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .item__opts { margin-top: 0.4rem; }
    .label { flex: 1 1 10rem; }
    .kind { flex: 0 0 9rem; }
    .target { flex: 2 1 14rem; }
    .spacer { flex: 1; }
  `,
})
export class MenusEditor {
  private readonly api = inject(AdminApi);
  protected readonly menus = signal<MenuEdit[]>([]);
  protected readonly pages = signal<PageSummary[]>([]);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected readonly help = HELP;
  /** Languages other than English: each menu label can be written in them. */

  constructor() {
    inject(Title).setTitle('Menus | Admin');
    void Promise.all([this.api.menus(), this.api.pages()])
      .then(([menus, pages]) => {
        this.menus.set(menus);
        this.pages.set(pages.sort((a, b) => a.path.localeCompare(b.path)));
      })
      .catch((err) => this.message.set({ kind: 'error', text: errorMessage(err) }));
  }

  add(list: MenuItemEdit[]) {
    const firstPage = this.pages()[0]?.id ?? null;
    list.push({ label: 'New link', pageId: firstPage, url: firstPage ? null : '/', openInNewTab: false, isButton: false, isVisible: true, children: [] });
  }

  move(list: MenuItemEdit[], i: number, step: number) {
    const j = i + step;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  }


  setKind(item: MenuItemEdit, kind: 'page' | 'url') {
    if (kind === 'page') {
      item.pageId = this.pages()[0]?.id ?? null;
      item.url = null;
    } else {
      item.pageId = null;
      item.url = item.url ?? '/';
    }
  }

  async save(menu: MenuEdit) {
    const clean = (items: MenuItemEdit[]): unknown[] =>
      items.map((i) => ({
        label: i.label,
        translations: Object.fromEntries(Object.entries(i.translations ?? {}).filter(([, v]) => v.trim())),
        ...(i.pageId !== null ? { pageId: i.pageId } : { url: i.url }),
        openInNewTab: i.openInNewTab,
        isButton: i.isButton,
        isVisible: i.isVisible,
        children: clean(i.children),
      }));
    try {
      await this.api.saveMenu(menu.location, clean(menu.items));
      this.message.set({ kind: 'success', text: `${menu.name} saved. Visitors see it straight away.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }
}

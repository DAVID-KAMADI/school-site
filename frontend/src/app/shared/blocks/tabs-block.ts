import { Component, input, signal } from '@angular/core';

let nextId = 0;

/** Accessible tabs (WAI-ARIA pattern): arrow keys move between tabs. */
@Component({
  selector: 'app-tabs-block',
  template: `
    <div class="tabs__list" role="tablist" (keydown)="onKey($event)">
      @for (item of items(); track $index; let i = $index) {
        <button
          type="button"
          role="tab"
          class="tabs__tab"
          [id]="id + '-tab-' + i"
          [attr.aria-selected]="selected() === i"
          [attr.aria-controls]="id + '-panel-' + i"
          [attr.tabindex]="selected() === i ? 0 : -1"
          (click)="selected.set(i)"
        >
          {{ item.title }}
        </button>
      }
    </div>
    @for (item of items(); track $index; let i = $index) {
      <div class="tabs__panel prose" role="tabpanel" [id]="id + '-panel-' + i" [attr.aria-labelledby]="id + '-tab-' + i" [hidden]="selected() !== i" [innerHTML]="item.html"></div>
    }
  `,
  styles: `
    .tabs__list {
      display: flex; gap: 0.4rem; padding: 0.35rem; margin-bottom: 1.25rem; width: fit-content; max-width: 100%;
      overflow-x: auto; scrollbar-width: none; background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px;
    }
    .tabs__tab {
      padding: 0.6rem 1.15rem; border: 0; border-radius: 999px; background: transparent; color: var(--text);
      font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer; transition: background-color 0.2s ease, color 0.2s ease;
    }
    .tabs__tab:hover { background: var(--surface-3); color: var(--primary); }
    .tabs__tab[aria-selected='true'] { background: var(--primary); color: #fff; box-shadow: 0 2px 8px rgb(0 38 128 / 0.25); }
    .tabs__panel {
      padding: clamp(1.25rem, 3vw, 2rem); background: var(--surface); border: 1px solid var(--line);
      border-top: 4px solid var(--action); border-radius: var(--radius); box-shadow: var(--shadow);
    }
    /* Panel text comes from the editor ([innerHTML]), so it is styled without view encapsulation. */
    .tabs__panel ::ng-deep > :first-child { margin-top: 0; }
    .tabs__panel ::ng-deep h3 { font-size: 1.3rem; color: var(--ink); }
    .tabs__panel ::ng-deep h3 + p { color: var(--muted); }
    .tabs__panel ::ng-deep ul {
      list-style: none; padding: 0; margin: 1.25rem 0 0; display: grid; gap: 0.6rem;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
    }
    .tabs__panel ::ng-deep ul li {
      position: relative; margin: 0; padding: 0.75rem 0.9rem 0.75rem 2.6rem; border-radius: var(--radius-sm);
      background: var(--surface-2); color: var(--ink); font-weight: 550;
    }
    .tabs__panel ::ng-deep ul li::before {
      content: ''; position: absolute; left: 0.9rem; top: 50%; width: 1.1rem; height: 1.1rem; translate: 0 -50%;
      border-radius: 50%; background: var(--accent);
    }
    .tabs__panel ::ng-deep ul li::after {
      content: ''; position: absolute; left: 1.27rem; top: 50%; width: 0.32rem; height: 0.58rem; translate: 0 -62%;
      border: solid #fff; border-width: 0 2px 2px 0; rotate: 45deg;
    }
  `,
})
export class TabsBlock {
  readonly items = input<{ title: string; html: string }[]>([]);
  protected readonly selected = signal(0);
  protected readonly id = `tabs-${nextId++}`;

  onKey(e: KeyboardEvent) {
    const n = this.items().length;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    this.selected.update((i) => (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
    const tab = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=tab]')[this.selected()];
    tab?.focus();
  }
}

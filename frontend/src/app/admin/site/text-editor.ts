import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type LanguageRow, type TextRow } from '../api';

interface Row {
  key: string;
  description: string | null;
  /** Text by language code. */
  values: Record<string, string>;
}

/** Button labels, form messages and other interface text, in English and each other site language. */
@Component({
  selector: 'app-text-editor',
  imports: [FormsModule],
  template: `
    <h1>Interface text</h1>
    <p class="a-muted">Labels and messages used across the site. Placeholders such as <code>{{ '{year}' }}</code> and <code>{{ '{institution_name}' }}</code> are filled in automatically.
      @if (others().length) {
        Leave a language empty to use English.
      } @else {
        To show this text in other languages, add them under Languages.
      }
    </p>
    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }
    <input class="a-input search" type="search" placeholder="Filter" [(ngModel)]="filter" aria-label="Filter text" />
    <div class="a-table-wrap">
      <table class="a-table">
        <thead>
          <tr>
            <th>Where it appears</th>
            <th>English</th>
            @for (l of others(); track l.code) {
              <th>{{ l.name }}</th>
            }
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.key) {
            @if (matches(r)) {
            <tr>
              <td><strong>{{ r.description ?? r.key }}</strong><div class="a-small a-muted">{{ r.key }}</div></td>
              <td><textarea class="a-textarea" rows="2" [(ngModel)]="r.values['en']" [attr.aria-label]="'English: ' + r.key"></textarea></td>
              @for (l of others(); track l.code) {
                <td><textarea class="a-textarea" rows="2" [(ngModel)]="r.values[l.code]" [attr.aria-label]="l.name + ': ' + r.key" [attr.lang]="l.code" [attr.dir]="l.dir"></textarea></td>
              }
              <td><button class="a-btn a-btn--sm a-btn--primary" type="button" (click)="save(r)">Save</button></td>
            </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .search { max-width: 20rem; margin-bottom: 0.75rem; }
    td:nth-child(1) { width: 28%; }
    textarea { min-height: 2.6rem; }
  `,
})
export class TextEditor {
  private readonly api = inject(AdminApi);
  protected filter = '';
  protected readonly rows = signal<Row[]>([]);
  /** Site languages other than English. */
  protected readonly others = signal<LanguageRow[]>([]);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);

  constructor() {
    inject(Title).setTitle('Interface text | Admin');
    void Promise.all([this.api.texts(), this.api.languages().catch(() => null)])
      .then(([rows, langs]) => {
        this.others.set(langs?.languages.filter((l) => l.code !== 'en') ?? []);
        this.rows.set(group(rows));
      })
      .catch((err) => this.message.set({ kind: 'error', text: errorMessage(err) }));
  }

  protected matches(r: Row) {
    const f = this.filter.toLowerCase();
    return !f || [r.key, r.description ?? '', ...Object.values(r.values)].some((v) => v.toLowerCase().includes(f));
  }

  async save(r: Row) {
    try {
      await this.api.saveText(r.key, 'en', r.values['en'] ?? '');
      for (const l of this.others()) {
        const value = r.values[l.code]?.trim();
        if (value) await this.api.saveText(r.key, l.code, value);
      }
      this.message.set({ kind: 'success', text: `Saved “${r.description ?? r.key}”.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }
}

function group(rows: TextRow[]): Row[] {
  const map = new Map<string, Row>();
  for (const t of rows) {
    const row = map.get(t.key) ?? { key: t.key, description: t.description, values: { en: '' } };
    row.values[t.locale] = t.value;
    if (t.locale === 'en') row.description = t.description;
    map.set(t.key, row);
  }
  return [...map.values()];
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type LanguageRow, type LanguagesInfo } from '../api';

/** Common choices, each named in its own language as visitors will see it. */
const SUGGESTED: LanguageRow[] = [
  { code: 'sw', name: 'Kiswahili' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'zh', name: '中文' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'so', name: 'Soomaali' },
  { code: 'am', name: 'አማርኛ' },
  { code: 'rw', name: 'Kinyarwanda' },
  { code: 'lg', name: 'Luganda' },
];

const SETTING_NAMES: Record<string, string> = {
  'institution.name': 'Institution name',
  'institution.short_name': 'Short name',
  'institution.tagline': 'Tagline',
  'contact.address': 'Address',
  'contact.office_hours': 'Office hours',
  'payments.mpesa_account_hint': 'M-Pesa account number instruction',
  'banner.alert': 'Announcement banner text',
  'banner.intake': 'Intake banner text',
  'seo.default_description': 'Default description for search engines',
  'admissions.welcome': 'Welcome text on the Apply page',
  'admissions.declaration': 'Declaration on the application form',
};

/**
 * The languages visitors can choose in the header, and the site details (name, tagline, address,
 * banners) written in each of them. Pages and menus are translated in their own editors.
 */
@Component({
  selector: 'app-languages-editor',
  imports: [FormsModule],
  template: `
    <h1>Languages</h1>
    <p class="a-muted intro">
      Once you add a second language, visitors see a language button in the header and can read the site in that language
      (for example <code>/fr/admissions</code> for French). Pages show in English, with a short notice, until you translate them:
      open a page and choose the language at the top of the editor. Menu labels are translated under Menus, and buttons and
      messages under Interface text.
    </p>
    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }

    <section class="a-panel a-stack">
      <h2>Languages on the site</h2>
      <div class="a-table-wrap">
        <table class="a-table">
          <thead><tr><th>Name visitors see</th><th>Code</th><th></th></tr></thead>
          <tbody>
            @for (l of list(); track l.code; let i = $index; let first = $first; let last = $last) {
              <tr>
                <td><input class="a-input" [(ngModel)]="l.name" maxlength="40" [attr.aria-label]="'Name for ' + l.code" [attr.lang]="l.code" /></td>
                <td><code>{{ l.code }}</code>@if (l.code === 'en') { <span class="a-small a-muted"> main language</span> }</td>
                <td class="tools">
                  @if (l.code !== 'en') {
                    <button class="a-btn a-btn--sm a-btn--icon" type="button" [disabled]="i === 1" (click)="move(i, -1)" aria-label="Move up">↑</button>
                    <button class="a-btn a-btn--sm a-btn--icon" type="button" [disabled]="last" (click)="move(i, 1)" aria-label="Move down">↓</button>
                    <button class="a-btn a-btn--sm a-btn--danger" type="button" (click)="remove(i)">Remove</button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="add a-row">
        <label class="a-field">
          <span>Add a language</span>
          <select class="a-select" [(ngModel)]="choice">
            <option value="">Choose…</option>
            @for (s of available(); track s.code) {
              <option [value]="s.code">{{ s.name }} ({{ s.code }})</option>
            }
            <option value="other">Another language…</option>
          </select>
        </label>
        @if (choice === 'other') {
          <label class="a-field code"><span>Code</span><input class="a-input" [(ngModel)]="otherCode" maxlength="2" placeholder="e.g. ki" /></label>
          <label class="a-field"><span>Name in that language</span><input class="a-input" [(ngModel)]="otherName" maxlength="40" placeholder="e.g. Gĩkũyũ" /></label>
        }
        <button class="a-btn" type="button" (click)="add()" [disabled]="!choice">Add</button>
      </div>
      <p class="a-help">Codes are the two-letter ISO 639-1 codes. Removing a language hides it from visitors; its translations are kept in case you add it again.</p>
      <div><button class="a-btn a-btn--primary" type="button" (click)="saveList()" [disabled]="busy()">Save languages</button></div>
    </section>

    @for (l of saved(); track l.code) {
      @if (l.code !== 'en') {
        <section class="a-panel a-stack">
          <h2>Site details in {{ l.name }}</h2>
          <p class="a-help">Leave a field empty to show the English text.</p>
          @for (s of info()?.translatableSettings ?? []; track s.key) {
            <label class="a-field">
              <span>{{ settingName(s.key) }}</span>
              @if (s.english.length > 80) {
                <textarea class="a-textarea" [(ngModel)]="drafts[l.code][s.key]" maxlength="5000" [attr.lang]="l.code" [attr.dir]="l.dir"></textarea>
              } @else {
                <input class="a-input" [(ngModel)]="drafts[l.code][s.key]" maxlength="5000" [attr.lang]="l.code" [attr.dir]="l.dir" />
              }
              <span class="a-help">English: {{ s.english || '(empty)' }}</span>
            </label>
          }
          <div><button class="a-btn a-btn--primary" type="button" (click)="saveSettings(l)">Save {{ l.name }} details</button></div>
        </section>
      }
    }
  `,
  styles: `
    .intro { max-width: 70ch; }
    .tools { text-align: right; white-space: nowrap; }
    .add { align-items: flex-end; }
    .code { flex: 0 0 6rem; }
  `,
})
export class LanguagesEditor {
  private readonly api = inject(AdminApi);
  protected readonly info = signal<LanguagesInfo | null>(null);
  /** The list being edited. */
  protected readonly list = signal<LanguageRow[]>([]);
  /** The list as last saved: only saved languages can have their details translated. */
  protected readonly saved = signal<LanguageRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected readonly available = computed(() => SUGGESTED.filter((s) => !this.list().some((l) => l.code === s.code)));
  protected drafts: Record<string, Record<string, string>> = {};
  protected choice = '';
  protected otherCode = '';
  protected otherName = '';

  constructor() {
    inject(Title).setTitle('Languages | Admin');
    void this.load();
  }

  private async load() {
    try {
      const info = await this.api.languages();
      this.info.set(info);
      this.list.set(info.languages.map((l) => ({ ...l })));
      this.saved.set(info.languages);
      this.drafts = Object.fromEntries(info.languages.map((l) => [l.code, { ...(info.settingTranslations[l.code] ?? {}) }]));
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected settingName(key: string) {
    return SETTING_NAMES[key] ?? key;
  }

  protected add() {
    const lang =
      this.choice === 'other'
        ? { code: this.otherCode.trim().toLowerCase(), name: this.otherName.trim() }
        : SUGGESTED.find((s) => s.code === this.choice);
    if (!lang) return;
    if (!/^[a-z]{2}$/.test(lang.code) || !lang.name) {
      this.message.set({ kind: 'error', text: 'Enter a two-letter code and the language’s name.' });
      return;
    }
    if (this.list().some((l) => l.code === lang.code)) {
      this.message.set({ kind: 'error', text: `${lang.code} is already in the list.` });
      return;
    }
    this.list.update((l) => [...l, { ...lang }]);
    this.choice = this.otherCode = this.otherName = '';
    this.message.set({ kind: 'info', text: `${lang.name} added. Click Save languages to show it on the site.` });
  }

  protected move(i: number, step: number) {
    const list = this.list().slice();
    const j = i + step;
    if (j < 1 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.list.set(list);
  }

  protected remove(i: number) {
    const l = this.list()[i];
    if (!confirm(`Remove ${l.name} from the site? Visitors will no longer be able to choose it.`)) return;
    this.list.update((list) => list.filter((_, k) => k !== i));
  }

  async saveList() {
    this.busy.set(true);
    try {
      const saved = await this.api.saveLanguages(this.list().map(({ code, name }) => ({ code, name })));
      this.saved.set(saved);
      this.list.set(saved.map((l) => ({ ...l })));
      for (const l of saved) this.drafts[l.code] ??= { ...(this.info()?.settingTranslations[l.code] ?? {}) };
      this.message.set({
        kind: 'success',
        text: saved.length > 1 ? 'Languages saved. Visitors can now choose them in the header.' : 'Languages saved. The site is English only, so the language button is hidden.',
      });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  async saveSettings(l: LanguageRow) {
    try {
      const values = await this.api.saveSettingTranslations(l.code, this.drafts[l.code] ?? {});
      this.drafts[l.code] = { ...values };
      this.info.update((i) => (i ? { ...i, settingTranslations: { ...i.settingTranslations, [l.code]: values } } : i));
      this.message.set({ kind: 'success', text: `${l.name} details saved.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }
}

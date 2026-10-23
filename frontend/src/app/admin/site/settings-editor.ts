import { KeyValuePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { errorMessage } from '../../core/api-url.interceptor';
import { AdminApi, type SettingRow } from '../api';
import { MediaField } from '../fields/media-field';
import { MediaCache } from '../media/media-cache';

const GROUP_NAMES: Record<string, string> = {
  institution: 'Institution',
  contact: 'Contact details',
  payments: 'Payments',
  social: 'Social media',
  banners: 'Banners',
  seo: 'Search engines',
  admissions: 'Admissions',
  portal: 'Student portal',
  legal: 'Legal (Terms and Privacy)',
};

/** Site-wide values used in the header, footer and contact blocks. Each field saves on its own. */
@Component({
  selector: 'app-settings-editor',
  imports: [FormsModule, MediaField, KeyValuePipe],
  template: `
    <h1>Site settings</h1>
    @if (message(); as m) {
      <div class="a-alert" [class]="'a-alert--' + m.kind" role="status">{{ m.text }}</div>
    }
    @for (group of groups(); track group.name) {
      <section class="a-panel a-stack">
        <h2>{{ groupName(group.name) }}</h2>
        @for (s of group.rows; track s.key) {
          <div class="setting">
            <div class="a-label">{{ label(s.key) }}</div>
            @if (s.description) {
              <div class="a-help">{{ s.description }}</div>
            }
            @if (s.key.endsWith('media_id')) {
              <app-media-field kind="image" [value]="$any(s.value)" (valueChange)="s.value = $event; save(s)" />
            } @else if (isObject(s.value)) {
              <div class="a-row obj">
                @for (f of $any(s.value) | keyvalue: keepOrder; track f.key) {
                  @if (f.key === 'enabled') {
                    <label class="a-check"><input type="checkbox" [(ngModel)]="$any(s.value)[f.key]" /> Show on the site</label>
                  } @else if (f.key === 'level') {
                    <label class="a-field"><span>Style</span>
                      <select class="a-select" [(ngModel)]="$any(s.value)[f.key]">
                        <option value="info">Information</option><option value="warning">Warning</option><option value="critical">Emergency</option>
                      </select>
                    </label>
                  } @else if (f.key === 'deadline') {
                    <label class="a-field"><span>Deadline</span><input class="a-input" type="date" [(ngModel)]="$any(s.value)[f.key]" /></label>
                  } @else if (f.key === 'lat' || f.key === 'lng') {
                    <label class="a-field"><span>{{ f.key === 'lat' ? 'Latitude' : 'Longitude' }}</span><input class="a-input" type="number" step="0.000001" [(ngModel)]="$any(s.value)[f.key]" /></label>
                  } @else if (isNumber(f.value)) {
                    <label class="a-field"><span>{{ label($any(f.key)) }}</span><input class="a-input" type="number" min="0" [(ngModel)]="$any(s.value)[f.key]" /></label>
                  } @else if (f.key === 'instructions' || f.key === 'body' || f.key === 'joining_instructions') {
                    <label class="a-field wide"><span>{{ label($any(f.key)) }}</span><textarea class="a-textarea" [(ngModel)]="$any(s.value)[f.key]" maxlength="2000"></textarea></label>
                  } @else {
                    <label class="a-field"><span>{{ label($any(f.key)) }}</span><input class="a-input" [(ngModel)]="$any(s.value)[f.key]" maxlength="500" /></label>
                  }
                }
              </div>
              <div><button class="a-btn a-btn--sm a-btn--primary" type="button" (click)="save(s)">Save</button></div>
            } @else {
              <div class="a-row inline">
                @if (s.key.includes('.message_')) {
                  <textarea class="a-textarea message" [(ngModel)]="s.value" maxlength="4000" rows="12" [attr.aria-label]="label(s.key)"></textarea>
                } @else if (s.key.endsWith('address') || s.key.endsWith('description') || s.key.endsWith('tagline') || s.key.endsWith('declaration') || s.key.endsWith('welcome')) {
                  <textarea class="a-textarea" [(ngModel)]="s.value" maxlength="1000" [attr.aria-label]="label(s.key)"></textarea>
                } @else {
                  <input class="a-input" [(ngModel)]="s.value" maxlength="500" [attr.aria-label]="label(s.key)" />
                }
                <button class="a-btn a-btn--sm a-btn--primary" type="button" (click)="save(s)">Save</button>
              </div>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .setting { display: grid; gap: 0.35rem; padding-bottom: 0.9rem; border-bottom: 1px solid var(--a-line); }
    .setting:last-child { border-bottom: 0; padding-bottom: 0; }
    .inline { align-items: flex-start; }
    .inline > .a-btn { flex: 0 0 auto; }
    .message { min-height: 16rem; font-family: inherit; line-height: 1.5; }
    .obj { align-items: flex-end; }
    .obj .wide { flex-basis: 100%; }
  `,
})
export class SettingsEditor {
  private readonly api = inject(AdminApi);
  private readonly cache = inject(MediaCache);
  protected readonly rows = signal<SettingRow[]>([]);
  protected readonly message = signal<{ kind: string; text: string } | null>(null);
  protected readonly groups = computed(() => {
    const map = new Map<string, SettingRow[]>();
    for (const r of this.rows()) map.set(r.groupName, [...(map.get(r.groupName) ?? []), r]);
    const order = Object.keys(GROUP_NAMES);
    return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([name, rows]) => ({ name, rows }));
  });
  protected readonly keepOrder = () => 0;

  constructor() {
    inject(Title).setTitle('Site settings | Admin');
    void this.load();
  }

  private async load() {
    try {
      const rows = await this.api.settings();
      const mediaIds = rows.filter((r) => r.key.endsWith('media_id') && typeof r.value === 'number').map((r) => r.value as number);
      for (const id of mediaIds) this.cache.add(await this.api.mediaItem(id).catch(() => null));
      this.rows.set(rows);
    } catch (err) {
      this.message.set({ kind: 'error', text: errorMessage(err) });
    }
  }

  protected groupName(name: string) {
    return GROUP_NAMES[name] ?? name;
  }

  protected label(key: string) {
    const last = key.split('.').pop()!.replace(/_media_id$/, '').replace(/_/g, ' ');
    const special: Record<string, string> = {
      x: 'X (Twitter)',
      'mpesa paybill': 'M-Pesa Paybill number',
      fee: 'Application fee',
      'number prefix': 'Application number prefix',
      welcome: 'Welcome text on the Apply page',
      declaration: 'Declaration',
      'offer letter': 'Offer letter',
      'offer acceptance days': 'Days to accept an offer',
      'student url': 'Student portal address',
      'joining instructions': 'Joining instructions (one per line, start with -)',
      body: 'Letter text (blank line between paragraphs)',
      'signatory name': 'Signed by (name)',
      'signatory title': 'Signed by (title)',
      'mpesa account hint': 'Account number instruction',
      'message offered': 'Ready-made message: Offer a place',
      'message rejected': 'Ready-made message: Not successful',
      'message info requested': 'Ready-made message: Request more information',
      'welcome screen': 'Welcome screen',
      animations: 'Page animations',
      whatsapp: 'WhatsApp number',
      linkedin: 'LinkedIn',
      youtube: 'YouTube',
      tiktok: 'TikTok',
    };
    return special[last] ?? last[0].toUpperCase() + last.slice(1);
  }

  protected isNumber(v: unknown) {
    return typeof v === 'number';
  }

  protected isObject(v: unknown) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  async save(s: SettingRow) {
    try {
      const value = this.isObject(s.value)
        ? Object.fromEntries(Object.entries(s.value as Record<string, unknown>).map(([k, v]) => [k, v === '' && (k === 'link' || k === 'deadline') ? null : v]))
        : s.value;
      await this.api.saveSetting(s.key, value);
      this.message.set({ kind: 'success', text: `${this.label(s.key)} saved.` });
    } catch (err) {
      this.message.set({ kind: 'error', text: `${this.label(s.key)}: ${errorMessage(err)}` });
    }
  }
}

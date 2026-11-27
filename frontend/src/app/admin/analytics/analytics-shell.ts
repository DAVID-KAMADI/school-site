import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthStore } from '../../core/auth';
import { Icon } from '../icon';
import { AnalyticsStore, CHANNEL_NAMES, countryName, PRESETS, today, type Filters, type Preset } from './analytics-data';

const TABS = [
  { path: '', label: 'Overview', exact: true },
  { path: 'realtime', label: 'Real-time' },
  { path: 'acquisition', label: 'Acquisition' },
  { path: 'geography', label: 'Geography' },
  { path: 'pages', label: 'Pages & content' },
  { path: 'devices', label: 'Devices & technology' },
  { path: 'events', label: 'Events & conversions' },
];

const FILTER_NAMES: Record<keyof Filters, string> = {
  channel: 'Channel',
  country: 'Country',
  device: 'Device',
  path: 'Page',
  event: 'Event',
};

/**
 * Admin → Web analytics: the tabs, the date range and the active filters, shared by every report.
 * Clicking a row in most breakdowns (a country, a channel, a device) filters the whole dashboard by it.
 */
@Component({
  selector: 'app-analytics-shell',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet, Icon],
  template: `
    <div class="a-toolbar a-toolbar--spread head">
      <div>
        <h1>Web analytics</h1>
        <p class="a-muted">Visits to the public website, counted by the site itself. Staff signed in to the portal aren't counted.</p>
      </div>
      <div class="a-toolbar range">
        <label class="sr-only" for="an-range">Date range</label>
        <select id="an-range" class="a-input" [ngModel]="store.preset()" (ngModelChange)="setPreset($event)">
          @for (p of presets; track p.key) {
            <option [value]="p.key">{{ p.label }}</option>
          }
        </select>
        @if (store.preset() === 'custom') {
          <input class="a-input" type="date" aria-label="From" [max]="store.customTo()" [ngModel]="store.customFrom()" (ngModelChange)="$event && store.customFrom.set($event)" />
          <span class="a-muted">to</span>
          <input class="a-input" type="date" aria-label="To" [min]="store.customFrom()" [max]="maxDay" [ngModel]="store.customTo()" (ngModelChange)="$event && store.customTo.set($event)" />
        }
      </div>
    </div>

    <nav class="tabs" aria-label="Analytics reports">
      @for (t of tabs; track t.path) {
        <a [routerLink]="t.path ? ['/admin/analytics', t.path] : ['/admin/analytics']" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: !!t.exact }">{{ t.label }}</a>
      }
      @if (canManage()) {
        <a routerLink="/admin/analytics/settings" routerLinkActive="on" class="tabs__settings"><app-icon name="sliders" [size]="16" /> Settings</a>
      }
    </nav>

    @if (chips().length) {
      <div class="chips" aria-label="Filters">
        <span class="a-muted a-small">Filtered by</span>
        @for (c of chips(); track c.key) {
          <button type="button" class="chip" (click)="store.setFilter(c.key, null)" [attr.aria-label]="'Remove filter ' + c.name + ': ' + c.value">
            {{ c.name }}: <strong>{{ c.value }}</strong> <app-icon name="close" [size]="14" />
          </button>
        }
        <button type="button" class="a-link-btn a-small" (click)="store.filters.set({})">Clear all</button>
      </div>
    }

    <router-outlet />

    <p class="credit a-small a-muted">
      Approximate locations: <a href="https://db-ip.com" target="_blank" rel="noopener">IP Geolocation by DB-IP</a> (CC BY 4.0).
      Map outlines: Natural Earth. Times are East Africa Time.
    </p>
  `,
  styles: `
    .head { align-items: flex-start; margin-bottom: 0.5rem; }
    .head h1 { margin-bottom: 0.25rem; }
    .head p { margin: 0; }
    .range select { min-width: 11rem; }
    .range input { width: auto; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .tabs { display: flex; gap: 0.25rem; margin: 1rem 0 1.25rem; border-bottom: 1px solid var(--a-line); overflow-x: auto; scrollbar-width: thin; }
    .tabs a { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.6rem 0.85rem; border-bottom: 3px solid transparent; margin-bottom: -1px; color: var(--a-muted); font-weight: 600; text-decoration: none; white-space: nowrap; }
    .tabs a:hover { color: var(--a-text); }
    .tabs a.on { color: var(--a-primary); border-bottom-color: var(--a-primary); }
    .tabs__settings { margin-left: auto; }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: -0.5rem 0 1rem; }
    .chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.55rem 0.25rem 0.75rem; border-radius: 999px; border: 1px solid #bcd3f7; background: var(--a-primary-soft); color: var(--a-primary-strong); font: inherit; font-size: 0.85rem; cursor: pointer; }
    .chip:hover { background: #dbe8fc; }
    .credit { margin-top: 2rem; }
  `,
})
export class AnalyticsShell {
  protected readonly store = inject(AnalyticsStore);
  private readonly auth = inject(AuthStore);
  protected readonly tabs = TABS;
  protected readonly presets = PRESETS;
  protected readonly maxDay = today();
  protected readonly canManage = computed(() => this.auth.canAny(['analytics.manage']));

  protected readonly chips = computed(() =>
    (Object.entries(this.store.filters()) as [keyof Filters, string][]).map(([key, value]) => ({
      key,
      name: FILTER_NAMES[key],
      value: key === 'country' ? countryName(value) : key === 'channel' ? (CHANNEL_NAMES[value] ?? value) : value,
    })),
  );

  constructor() {
    inject(Title).setTitle('Web analytics · Admin');
  }

  protected setPreset(p: Preset) {
    if (p === 'custom') {
      const r = this.store.range();
      this.store.customFrom.set(r.from);
      this.store.customTo.set(r.to);
    }
    this.store.preset.set(p);
  }
}

/** Loads a report whenever the range or filters change; tracks loading and errors. */
export function report<T>(load: () => Promise<T>) {
  const data = signal<T | null>(null);
  const loading = signal(true);
  const error = signal('');
  let seq = 0;
  const run = async () => {
    const mine = ++seq;
    loading.set(true);
    error.set('');
    try {
      const v = await load();
      if (mine === seq) data.set(v);
    } catch (e) {
      if (mine === seq) error.set((e as { error?: { message?: string } })?.error?.message ?? 'The report could not be loaded. Try again.');
    } finally {
      if (mine === seq) loading.set(false);
    }
  };
  return { data, loading, error, run };
}

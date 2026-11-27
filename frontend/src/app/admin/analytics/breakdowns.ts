import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { report } from './analytics-shell';
import {
  AnalyticsStore,
  CHANNEL_NAMES,
  countryName,
  duration,
  flag,
  num,
  pct,
  type Acquisition,
  type Devices,
  type Geography,
  type Metrics,
  type Pages,
} from './analytics-data';
import { BarList, SplitBar, WorldMap } from './charts';
import { Skeleton, TAB_STYLES } from './shared';

/** Loads the report whenever the date range or filters change. */
function onQuery(store: AnalyticsStore, run: () => void) {
  effect(() => {
    store.query();
    untracked(run);
  });
}

/** Sortable metrics table used by several tabs. */
type Col = 'visitors' | 'sessions' | 'pageViews' | 'engagementRate' | 'conversions' | 'conversionRate';
const COLS: { key: Col; label: string; fmt: (v: number) => string }[] = [
  { key: 'visitors', label: 'Visitors', fmt: num },
  { key: 'sessions', label: 'Sessions', fmt: num },
  { key: 'pageViews', label: 'Page views', fmt: num },
  { key: 'engagementRate', label: 'Engaged', fmt: (v) => pct(v) },
  { key: 'conversions', label: 'Conversions', fmt: num },
  { key: 'conversionRate', label: 'Conv. rate', fmt: (v) => pct(v) },
];

function sorter<T extends Metrics>(rows: () => T[]) {
  const sort = signal<Col>('sessions');
  const desc = signal(true);
  const sorted = computed(() => {
    const k = sort();
    const d = desc() ? -1 : 1;
    return [...rows()].sort((a, b) => (a[k] - b[k]) * d);
  });
  const toggle = (k: Col) => {
    if (sort() === k) desc.update((v) => !v);
    else (sort.set(k), desc.set(true));
  };
  return { sort, desc, sorted, toggle };
}

// ---- Acquisition ---------------------------------------------------------------------

@Component({
  selector: 'app-analytics-acquisition',
  imports: [BarList, Skeleton],
  template: `
    @if (acq.error()) {
      <p class="a-alert a-alert--error" role="alert">{{ acq.error() }}</p>
    }
    @if (acq.data(); as a) {
      <section class="a-panel">
        <div class="panel-head">
          <div><h2>Channels</h2><p class="a-small a-muted">How visitors found the site. Click a channel to filter the whole dashboard by it.</p></div>
          <a class="a-btn a-btn--sm export" [href]="store.exportUrl('channels')" download>CSV</a>
        </div>
        <div class="a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                @for (c of cols; track c.key) {
                  <th scope="col" class="num" [attr.aria-sort]="channels.sort() === c.key ? (channels.desc() ? 'descending' : 'ascending') : null">
                    <button type="button" class="row-btn" (click)="channels.toggle(c.key)">{{ c.label }}{{ channels.sort() === c.key ? (channels.desc() ? ' ↓' : ' ↑') : '' }}</button>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of channels.sorted(); track r.channel) {
                <tr>
                  <td><button type="button" class="row-btn" (click)="store.setFilter('channel', r.channel)">{{ channelName(r.channel) }}</button></td>
                  @for (c of cols; track c.key) {
                    <td class="num">{{ c.fmt(r[c.key]) }}</td>
                  }
                </tr>
              } @empty {
                <tr><td [attr.colspan]="cols.length + 1" class="a-muted">No visits in this period.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <div class="two">
        <section class="a-panel">
          <div class="panel-head">
            <div><h2>Referring websites</h2><p class="a-small a-muted">Sites with a link that visitors followed.</p></div>
            <a class="a-btn a-btn--sm export" [href]="store.exportUrl('referrers')" download>CSV</a>
          </div>
          <an-bar-list [rows]="referrerRows()" [limit]="12" empty="No visits from other websites in this period." />
        </section>
        <section class="a-panel">
          <div class="panel-head">
            <div><h2>Campaigns (UTM)</h2><p class="a-small a-muted">Links tagged with utm_source, utm_medium, utm_campaign, utm_term or utm_content.</p></div>
            <a class="a-btn a-btn--sm export" [href]="store.exportUrl('campaigns')" download>CSV</a>
          </div>
          @if (a.campaigns.length) {
            <div class="a-table-wrap">
              <table class="a-table">
                <thead><tr><th scope="col">Campaign</th><th scope="col">Source / medium</th><th scope="col" class="num">Sessions</th><th scope="col" class="num">Conv.</th></tr></thead>
                <tbody>
                  @for (c of a.campaigns; track $index) {
                    <tr>
                      <td class="path">{{ c.campaign || '(no campaign)' }}@if (c.term || c.content) {<small>{{ c.term }}{{ c.term && c.content ? ' · ' : '' }}{{ c.content }}</small>}</td>
                      <td>{{ c.source || '—' }} / {{ c.medium || '—' }}</td>
                      <td class="num">{{ num(c.sessions) }}</td>
                      <td class="num">{{ num(c.conversions) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="a-muted a-small">No tagged visits yet. Add tags to links you share, for example:</p>
            <code class="example">https://your-site/apply?utm_source=facebook&amp;utm_medium=social&amp;utm_campaign=jan-intake</code>
          }
        </section>
      </div>
    } @else if (acq.loading()) {
      <an-skeleton [height]="300" />
    }
  `,
  styles: TAB_STYLES + `.example { display: block; padding: 0.6rem 0.75rem; background: #f5f7fb; border-radius: 8px; font-size: 0.8rem; overflow-wrap: anywhere; }`,
})
export class AnalyticsAcquisition {
  protected readonly store = inject(AnalyticsStore);
  protected readonly cols = COLS;
  protected readonly num = num;
  protected readonly acq = report(() => this.store.get<Acquisition>('acquisition'));
  protected readonly channels = sorter(() => this.acq.data()?.channels ?? []);
  protected readonly channelName = (k: string) => CHANNEL_NAMES[k] ?? k;
  protected readonly referrerRows = computed(() =>
    (this.acq.data()?.referrers ?? []).map((r) => ({ key: r.host, label: r.host, value: r.sessions, note: pct(r.engagementRate, 0) + ' engaged' })),
  );
  constructor() {
    onQuery(this.store, () => void this.acq.run());
  }
}

// ---- Geography -----------------------------------------------------------------------

@Component({
  selector: 'app-analytics-geography',
  imports: [BarList, WorldMap, Skeleton],
  template: `
    @if (geo.error()) {
      <p class="a-alert a-alert--error" role="alert">{{ geo.error() }}</p>
    }
    <section class="a-panel">
      <div class="panel-head">
        <div><h2>Visitors by country</h2><p class="a-small a-muted">Approximate, from the visitor's network. Click a country to filter by it.</p></div>
        <a class="a-btn a-btn--sm export" [href]="store.exportUrl('countries')" download>CSV</a>
      </div>
      <an-world-map [values]="mapValues()" (pick)="store.setFilter('country', $event)" />
    </section>
    @if (geo.data(); as g) {
      <div class="two">
        <section class="a-panel">
          <div class="panel-head"><h2>Countries</h2></div>
          <an-bar-list [rows]="countryRows()" [limit]="15" [selectable]="true" (pick)="store.setFilter('country', $event)" />
        </section>
        <section class="a-panel">
          <div class="panel-head">
            <div><h2>Cities and regions</h2><p class="a-small a-muted">Approximate: often the city of the mobile network's exchange.</p></div>
            <a class="a-btn a-btn--sm export" [href]="store.exportUrl('cities')" download>CSV</a>
          </div>
          <an-bar-list [rows]="cityRows()" [limit]="15" empty="No city data yet (the location database may still be downloading)." />
        </section>
      </div>
    } @else if (geo.loading()) {
      <div class="two"><an-skeleton /><an-skeleton /></div>
    }
  `,
  styles: TAB_STYLES,
})
export class AnalyticsGeography {
  protected readonly store = inject(AnalyticsStore);
  protected readonly geo = report(() => this.store.get<Geography>('geography'));
  protected readonly mapValues = computed(() => {
    const out: Record<string, number> = {};
    for (const c of this.geo.data()?.countries ?? []) if (c.country) out[c.country] = c.visitors;
    return out;
  });
  protected readonly countryRows = computed(() =>
    (this.geo.data()?.countries ?? []).map((c) => ({ key: c.country ?? '', label: countryName(c.country), icon: flag(c.country), value: c.visitors, note: pct(c.engagementRate, 0) + ' engaged' })),
  );
  protected readonly cityRows = computed(() =>
    (this.geo.data()?.cities ?? []).map((c) => ({
      key: `${c.country}-${c.region}-${c.city}`,
      label: [c.city, c.region && c.region !== c.city ? c.region : null].filter(Boolean).join(', '),
      icon: flag(c.country),
      value: c.visitors,
    })),
  );
  constructor() {
    onQuery(this.store, () => void this.geo.run());
  }
}

// ---- Pages ---------------------------------------------------------------------------

type PageSort = 'views' | 'visitors' | 'time' | 'entries' | 'path';

@Component({
  selector: 'app-analytics-pages',
  imports: [FormsModule, Skeleton],
  template: `
    <section class="a-panel">
      <div class="panel-head">
        <div><h2>Pages and content</h2><p class="a-small a-muted">Click a page to see the whole dashboard for visits that included it.</p></div>
        <div class="a-toolbar">
          <input class="a-input search" type="search" placeholder="Search address or title" aria-label="Search pages" [ngModel]="search()" (ngModelChange)="setSearch($event)" />
          <a class="a-btn a-btn--sm export" [href]="store.exportUrl('pages', { search: search() || undefined })" download>CSV</a>
        </div>
      </div>
      @if (pages.error()) {
        <p class="a-alert a-alert--error" role="alert">{{ pages.error() }}</p>
      }
      @if (pages.data(); as p) {
        <div class="a-table-wrap">
          <table class="a-table">
            <thead>
              <tr>
                @for (c of columns; track c.label) {
                  <th scope="col" [class.num]="c.num" [attr.aria-sort]="c.sort && sort() === c.sort ? (dir() === 'desc' ? 'descending' : 'ascending') : null">
                    @if (c.sort) {
                      <button type="button" class="row-btn" (click)="toggle(c.sort)">{{ c.label }}{{ sort() === c.sort ? (dir() === 'desc' ? ' ↓' : ' ↑') : '' }}</button>
                    } @else {
                      <span [title]="c.help ?? ''">{{ c.label }}</span>
                    }
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of p.rows; track r.path) {
                <tr>
                  <td class="path">
                    <button type="button" class="row-btn" (click)="store.setFilter('path', r.path)" [title]="'Filter by ' + r.path">{{ r.title || r.path }}</button>
                    <small>{{ r.path }}</small>
                  </td>
                  <td class="num">{{ num(r.views) }}</td>
                  <td class="num">{{ num(r.visitors) }}</td>
                  <td class="num">{{ duration(r.avgEngagementTime) }}</td>
                  <td class="num">{{ num(r.entries) }}</td>
                  <td class="num">{{ num(r.exits) }}</td>
                  <td class="num">{{ r.entries ? pct(r.bounceRate) : '—' }}</td>
                  <td class="num">{{ num(r.conversions) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="8" class="a-muted">{{ search() ? 'No pages match the search.' : 'No page views in this period.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (p.total > p.size) {
          <div class="pager a-toolbar">
            <button type="button" class="a-btn a-btn--sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button>
            <span class="a-small a-muted">Page {{ page() }} of {{ pageCount() }} · {{ num(p.total) }} pages</span>
            <button type="button" class="a-btn a-btn--sm" [disabled]="page() >= pageCount()" (click)="go(page() + 1)">Next</button>
          </div>
        }
      } @else if (pages.loading()) {
        <an-skeleton [height]="360" />
      }
    </section>
  `,
  styles: TAB_STYLES + `.search { width: 15rem; } .pager { justify-content: flex-end; margin-top: 0.85rem; }`,
})
export class AnalyticsPages {
  protected readonly store = inject(AnalyticsStore);
  protected readonly num = num;
  protected readonly pct = pct;
  protected readonly duration = duration;
  protected readonly columns: { label: string; sort?: PageSort; num?: boolean; help?: string }[] = [
    { label: 'Page', sort: 'path' },
    { label: 'Views', sort: 'views', num: true },
    { label: 'Visitors', sort: 'visitors', num: true },
    { label: 'Avg. time', sort: 'time', num: true },
    { label: 'Entries', sort: 'entries', num: true },
    { label: 'Exits', num: true, help: 'Visits that ended on this page' },
    { label: 'Bounce', num: true, help: 'Of visits that started on this page, the share that bounced' },
    { label: 'Conv.', num: true, help: 'Goals reached on this page' },
  ];
  protected readonly sort = signal<PageSort>('views');
  protected readonly dir = signal<'asc' | 'desc'>('desc');
  protected readonly page = signal(1);
  protected readonly search = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly pages = report(() =>
    this.store.get<Pages>('pages', { sort: this.sort(), dir: this.dir(), page: this.page(), size: 25, search: this.search() || undefined }),
  );
  protected readonly pageCount = computed(() => {
    const p = this.pages.data();
    return p ? Math.max(1, Math.ceil(p.total / p.size)) : 1;
  });

  constructor() {
    onQuery(this.store, () => {
      this.page.set(1);
      void this.pages.run();
    });
  }

  protected toggle(s: PageSort) {
    if (this.sort() === s) this.dir.update((d) => (d === 'desc' ? 'asc' : 'desc'));
    else (this.sort.set(s), this.dir.set(s === 'path' ? 'asc' : 'desc'));
    this.page.set(1);
    void this.pages.run();
  }

  protected go(p: number) {
    this.page.set(p);
    void this.pages.run();
  }

  protected setSearch(v: string) {
    this.search.set(v);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      void this.pages.run();
    }, 300);
  }
}

// ---- Devices -------------------------------------------------------------------------

const DEVICE_NAMES: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };
const SCREEN_NAMES: Record<string, string> = {
  small: 'Small (phones, under 576 px)',
  medium: 'Medium (576–991 px)',
  large: 'Large (992–1439 px)',
  xlarge: 'Extra large (1440 px+)',
};

@Component({
  selector: 'app-analytics-devices',
  imports: [BarList, SplitBar, Skeleton],
  template: `
    @if (dev.error()) {
      <p class="a-alert a-alert--error" role="alert">{{ dev.error() }}</p>
    }
    @if (dev.data(); as d) {
      <section class="a-panel">
        <div class="panel-head">
          <h2>Device types</h2>
          <a class="a-btn a-btn--sm export" [href]="store.exportUrl('devices')" download>CSV</a>
        </div>
        <an-split-bar [parts]="deviceParts()" />
        <div class="a-table-wrap devices">
          <table class="a-table">
            <thead><tr><th scope="col">Device</th><th scope="col" class="num">Visitors</th><th scope="col" class="num">Sessions</th><th scope="col" class="num">Engaged</th><th scope="col" class="num">Bounce</th><th scope="col" class="num">Conv. rate</th></tr></thead>
            <tbody>
              @for (r of d.devices; track r.name) {
                <tr>
                  <td><button type="button" class="row-btn" (click)="store.setFilter('device', r.name)">{{ deviceName(r.name) }}</button></td>
                  <td class="num">{{ num(r.visitors) }}</td>
                  <td class="num">{{ num(r.sessions) }}</td>
                  <td class="num">{{ pct(r.engagementRate) }}</td>
                  <td class="num">{{ pct(r.bounceRate) }}</td>
                  <td class="num">{{ pct(r.conversionRate) }}</td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="a-muted">No visits in this period.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="note a-small a-muted">A much higher bounce rate on one device type often points to a layout or speed problem on it.</p>
      </section>
      <div class="three">
        <section class="a-panel"><div class="panel-head"><h2>Browsers</h2></div><an-bar-list [rows]="rows(d.browsers)" /></section>
        <section class="a-panel"><div class="panel-head"><h2>Operating systems</h2></div><an-bar-list [rows]="rows(d.systems)" /></section>
        <section class="a-panel"><div class="panel-head"><h2>Screen sizes</h2></div><an-bar-list [rows]="rows(d.screens, screenName)" /></section>
      </div>
    } @else if (dev.loading()) {
      <an-skeleton [height]="300" />
    }
  `,
  styles: TAB_STYLES + `.devices { margin-top: 1.1rem; }`,
})
export class AnalyticsDevices {
  protected readonly store = inject(AnalyticsStore);
  protected readonly num = num;
  protected readonly pct = pct;
  protected readonly dev = report(() => this.store.get<Devices>('devices'));
  protected readonly deviceName = (k: string | null) => (k ? (DEVICE_NAMES[k] ?? k) : 'Unknown');
  protected readonly screenName = (k: string | null) => (k ? (SCREEN_NAMES[k] ?? k) : 'Unknown');
  protected readonly deviceParts = computed(() =>
    ['desktop', 'mobile', 'tablet'].map((k) => ({ label: DEVICE_NAMES[k], value: this.dev.data()?.devices.find((d) => d.name === k)?.visitors ?? 0 })),
  );
  constructor() {
    onQuery(this.store, () => void this.dev.run());
  }
  protected rows(list: (Metrics & { name: string | null })[], label: (k: string | null) => string = (k) => k ?? 'Unknown') {
    return list.map((x) => ({ key: x.name ?? '', label: label(x.name), value: x.visitors, note: pct(x.engagementRate, 0) + ' engaged' }));
  }
}

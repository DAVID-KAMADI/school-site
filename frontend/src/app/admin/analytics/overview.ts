import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { report } from './analytics-shell';
import {
  AnalyticsStore,
  bucketLabel,
  CHANNEL_NAMES,
  compact,
  countryName,
  duration,
  flag,
  num,
  pct,
  type Acquisition,
  type Geography,
  type Interval,
  type Overview,
  type Pages,
  type SeriesPoint,
  type Totals,
  type Trends,
} from './analytics-data';
import { BarList, Heatmap, Kpi, LineChart, SplitBar, type LineSeries } from './charts';
import { NoData, Skeleton, TAB_STYLES } from './shared';

type Metric = 'visitors' | 'sessions' | 'pageViews' | 'engagementRate' | 'conversions' | 'newReturning';

const METRICS: { key: Metric; label: string }[] = [
  { key: 'visitors', label: 'Visitors' },
  { key: 'newReturning', label: 'New vs returning' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'pageViews', label: 'Page views' },
  { key: 'engagementRate', label: 'Engagement rate' },
  { key: 'conversions', label: 'Conversions' },
];

interface Card {
  key: keyof Totals;
  metric?: Metric;
  label: string;
  help: string;
  format: (v: number) => string;
  invert?: boolean;
}

const CARDS: Card[] = [
  { key: 'visitors', metric: 'visitors', label: 'Unique visitors', format: num, help: 'Different people (browsers) who visited. Visitors who chose "Essential only" cookies are counted once per visit.' },
  { key: 'sessions', metric: 'sessions', label: 'Sessions', format: num, help: 'Visits. A visit ends after 30 minutes without activity.' },
  { key: 'pageViews', metric: 'pageViews', label: 'Page views', format: num, help: 'Pages opened, including repeat views of the same page.' },
  { key: 'avgSessionDuration', label: 'Avg. session duration', format: duration, help: 'Average time from the first to the last activity in a visit.' },
  { key: 'bounceRate', label: 'Bounce rate', format: (v) => pct(v), invert: true, help: 'Share of visits with one page, under 10 seconds and no clicks tracked. Lower is better.' },
  { key: 'engagementRate', metric: 'engagementRate', label: 'Engagement rate', format: (v) => pct(v), help: 'Share of visits that lasted 10+ seconds, viewed 2+ pages or clicked something tracked.' },
  { key: 'conversions', metric: 'conversions', label: 'Conversions', format: num, help: 'Goals reached (applications, sign-ups, downloads, contact clicks…), at most once per goal per visit.' },
  { key: 'conversionRate', label: 'Conversion rate', format: (v) => pct(v), help: 'Share of visits that reached at least one goal.' },
];

/** Web analytics → Overview: headline numbers, the traffic trend and when people visit. */
@Component({
  selector: 'app-analytics-overview',
  imports: [Kpi, LineChart, BarList, Heatmap, SplitBar, Skeleton, NoData],
  template: `
    @if (overview.error()) {
      <p class="a-alert a-alert--error" role="alert">{{ overview.error() }}</p>
    }
    @if (overview.data(); as o) {
      @if (!o.hasData) {
        <an-no-data />
      }
      <div class="kpis">
        @for (c of cards; track c.key) {
          @if (c.metric) {
            <button type="button" (click)="metric.set(c.metric!)" [attr.aria-pressed]="metric() === c.metric" [title]="'Show ' + c.label + ' on the chart'">
              <an-kpi [label]="c.label" [value]="c.format(o.current[c.key])" [current]="o.current[c.key]" [previous]="o.previous[c.key]" [invert]="!!c.invert" [help]="c.help" [active]="metric() === c.metric" />
            </button>
          } @else {
            <an-kpi [label]="c.label" [value]="c.format(o.current[c.key])" [current]="o.current[c.key]" [previous]="o.previous[c.key]" [invert]="!!c.invert" [help]="c.help" />
          }
        }
      </div>
    } @else if (overview.loading()) {
      <div class="kpis">@for (c of cards; track c.key) {<an-skeleton [height]="104" />}</div>
    }

    <section class="a-panel">
      <div class="panel-head">
        <div>
          <h2>{{ metricLabel() }} over time</h2>
          @if (overview.data(); as o) {
            <p class="a-muted a-small">Compared with {{ o.previousRange.from }} – {{ o.previousRange.to }} in the cards above.</p>
          }
        </div>
        <div class="a-toolbar">
          <label class="a-small a-muted" for="an-metric">Show</label>
          <select id="an-metric" class="a-input metric" [value]="metric()" (change)="metric.set($any($event.target).value)">
            @for (m of metrics; track m.key) {
              <option [value]="m.key">{{ m.label }}</option>
            }
          </select>
          <div class="seg" role="group" aria-label="Group by">
            @for (i of intervals; track i.key) {
              <button type="button" [class.on]="interval() === i.key" (click)="interval.set(i.key)" [disabled]="i.key === 'hour' && tooLongForHours()" [attr.aria-pressed]="interval() === i.key">{{ i.label }}</button>
            }
          </div>
          <a class="a-btn a-btn--sm export" [href]="store.exportUrl('trend')" download>CSV</a>
        </div>
      </div>
      @if (trends.data(); as t) {
        <an-line-chart [series]="series()" [labels]="axisLabels()" [longLabels]="tipLabels()" [format]="valueFormat()" [ariaLabel]="metricLabel() + ' by ' + t.interval" />
      } @else {
        <an-skeleton [height]="260" />
      }
    </section>

    <div class="two">
      <section class="a-panel">
        <div class="panel-head"><h2>New and returning visitors</h2></div>
        @if (overview.data(); as o) {
          <an-split-bar [parts]="[
            { label: 'New', value: o.current.newVisitors },
            { label: 'Returning', value: o.current.returningVisitors },
            { label: 'Not identified', value: o.current.unidentifiedVisitors, color: '#c9d1dd' }
          ]" />
          <p class="note a-small a-muted">Returning visitors can only be recognised when they accepted all cookies. Others are "not identified".</p>
        } @else {
          <an-skeleton [height]="60" />
        }
      </section>
      <section class="a-panel">
        <div class="panel-head"><h2>When people visit</h2><span class="a-small a-muted">Sessions by day and hour</span></div>
        @if (trends.data(); as t) {
          <an-heatmap [cells]="t.heatmap" />
        } @else {
          <an-skeleton [height]="150" />
        }
      </section>
    </div>

    <div class="three">
      <section class="a-panel">
        <div class="panel-head"><h2>Top pages</h2></div>
        @if (pages.data(); as p) {
          <an-bar-list [rows]="pageRows()" [selectable]="true" (pick)="store.setFilter('path', $event)" />
        } @else {
          <an-skeleton />
        }
      </section>
      <section class="a-panel">
        <div class="panel-head"><h2>Where visitors come from</h2></div>
        @if (acq.data(); as a) {
          <an-bar-list [rows]="channelRows()" [selectable]="true" (pick)="store.setFilter('channel', $event)" />
        } @else {
          <an-skeleton />
        }
      </section>
      <section class="a-panel">
        <div class="panel-head"><h2>Top countries</h2></div>
        @if (geo.data(); as g) {
          <an-bar-list [rows]="countryRows()" [selectable]="true" (pick)="store.setFilter('country', $event)" />
        } @else {
          <an-skeleton />
        }
      </section>
    </div>
  `,
  styles: TAB_STYLES + `.metric { width: auto; min-width: 10rem; }`,
})
export class AnalyticsOverview {
  protected readonly store = inject(AnalyticsStore);
  protected readonly cards = CARDS;
  protected readonly metrics = METRICS;
  protected readonly intervals: { key: Interval; label: string }[] = [
    { key: 'hour', label: 'Hourly' },
    { key: 'day', label: 'Daily' },
    { key: 'week', label: 'Weekly' },
    { key: 'month', label: 'Monthly' },
  ];
  protected readonly metric = signal<Metric>('visitors');
  protected readonly interval = signal<Interval>('day');

  protected readonly overview = report(() => this.store.get<Overview>('overview'));
  protected readonly trends = report(() => this.store.get<Trends>('trends', { interval: this.interval() }));
  protected readonly pages = report(() => this.store.get<Pages>('pages', { size: 8 }));
  protected readonly acq = report(() => this.store.get<Acquisition>('acquisition'));
  protected readonly geo = report(() => this.store.get<Geography>('geography'));

  protected readonly tooLongForHours = computed(() => {
    const r = this.store.range();
    return (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 >= 14;
  });

  constructor() {
    effect(() => {
      this.store.query();
      untracked(() => {
        if (this.store.range().from === this.store.range().to && this.interval() === 'day') this.interval.set('hour');
        if (this.tooLongForHours() && this.interval() === 'hour') this.interval.set('day');
        void this.overview.run();
        void this.pages.run();
        void this.acq.run();
        void this.geo.run();
      });
    });
    effect(() => {
      this.store.query();
      this.interval();
      untracked(() => void this.trends.run());
    });
  }

  protected readonly metricLabel = computed(() => METRICS.find((m) => m.key === this.metric())?.label ?? '');
  protected readonly valueFormat = computed(() => (this.metric() === 'engagementRate' ? (v: number) => pct(v) : num));

  protected readonly series = computed<LineSeries[]>(() => {
    const s = this.trends.data()?.series ?? [];
    const m = this.metric();
    if (m === 'newReturning')
      return [
        { name: 'New', values: s.map((p) => p.newVisitors) },
        { name: 'Returning', values: s.map((p) => p.returningVisitors) },
      ];
    return [{ name: this.metricLabel(), values: s.map((p) => p[m as keyof SeriesPoint] as number) }];
  });
  protected readonly axisLabels = computed(() => {
    const t = this.trends.data();
    return t ? t.series.map((p) => bucketLabel(p.bucket, t.interval)) : [];
  });
  protected readonly tipLabels = computed(() => {
    const t = this.trends.data();
    return t ? t.series.map((p) => bucketLabel(p.bucket, t.interval, true)) : [];
  });

  protected readonly pageRows = computed(() =>
    (this.pages.data()?.rows ?? []).map((p) => ({ key: p.path, label: p.title ? `${p.title} (${p.path})` : p.path, value: p.views })),
  );
  protected readonly channelRows = computed(() =>
    (this.acq.data()?.channels ?? []).map((c) => ({ key: c.channel, label: CHANNEL_NAMES[c.channel] ?? c.channel, value: c.sessions, note: compact(c.conversions) + ' conv.' })),
  );
  protected readonly countryRows = computed(() =>
    (this.geo.data()?.countries ?? []).map((c) => ({ key: c.country ?? '', label: countryName(c.country), icon: flag(c.country), value: c.visitors })),
  );
}

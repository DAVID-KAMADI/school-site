import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { AnalyticsStore, CHANNEL_NAMES, clock, countryName, flag, num, type Realtime } from './analytics-data';
import { BarList, Columns } from './charts';
import { Skeleton, TAB_STYLES } from './shared';

const EVERY_MS = 10_000;
const DEVICE_NAMES: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

/** Web analytics → Real-time: who is on the site right now. Polls every 10 s while the tab is visible. */
@Component({
  selector: 'app-analytics-realtime',
  imports: [BarList, Columns, Skeleton],
  template: `
    @if (error()) {
      <p class="a-alert a-alert--error" role="alert">{{ error() }}</p>
    }
    @if (data(); as d) {
      <div class="live">
        <section class="a-panel now">
          <p class="label"><span class="dot" [class.dot--on]="d.activeVisitors > 0" aria-hidden="true"></span> Active visitors right now</p>
          <p class="big" aria-live="polite">{{ num(d.activeVisitors) }}</p>
          <p class="a-small a-muted">{{ num(d.activeSessions) }} active {{ d.activeSessions === 1 ? 'session' : 'sessions' }} · seen in the last 5 minutes</p>
          <p class="a-small a-muted">Updated {{ clock(d.at) }} @if (paused()) {<span>(paused while this tab is hidden)</span>}</p>
        </section>
        <section class="a-panel">
          <div class="panel-head"><h2>Page views per minute</h2><span class="a-small a-muted">Last 30 minutes</span></div>
          <an-columns [values]="d.viewsPerMinute" />
        </section>
      </div>

      <div class="three">
        <section class="a-panel">
          <div class="panel-head"><h2>Pages being viewed</h2></div>
          <an-bar-list [rows]="rows(d.pages)" empty="Nobody is on the site right now." />
        </section>
        <section class="a-panel">
          <div class="panel-head"><h2>Traffic sources</h2></div>
          <an-bar-list [rows]="rows(d.channels, channelName)" empty="—" />
        </section>
        <section class="a-panel">
          <div class="panel-head"><h2>Countries</h2></div>
          <an-bar-list [rows]="countryRows()" empty="—" />
          <div class="panel-head devices"><h2>Devices</h2></div>
          <an-bar-list [rows]="rows(d.devices, deviceName)" empty="—" />
        </section>
      </div>

      <div class="two">
        <section class="a-panel">
          <div class="panel-head"><h2>Latest page views</h2><span class="a-small a-muted">Last 30 minutes</span></div>
          @if (d.recentViews.length) {
            <ul class="feed">
              @for (v of d.recentViews; track $index) {
                <li>
                  <time>{{ clock(v.viewedAt) }}</time>
                  <span class="path"><strong>{{ v.title || v.path }}</strong><small>{{ v.path }}</small></span>
                  <span class="meta">{{ flag(v.country) }} {{ v.city || countryName(v.country) }} · {{ deviceName(v.device) }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="a-muted a-small">No page views in the last 30 minutes.</p>
          }
        </section>
        <section class="a-panel">
          <div class="panel-head"><h2>Latest events</h2><span class="a-small a-muted">Clicks, downloads, sign-ups…</span></div>
          @if (d.recentEvents.length) {
            <ul class="feed">
              @for (e of d.recentEvents; track $index) {
                <li>
                  <time>{{ clock(e.occurredAt) }}</time>
                  <span class="path"><strong>{{ e.name }}</strong><small>{{ e.label || e.path }}</small></span>
                  <span class="meta">{{ flag(e.country) }} {{ deviceName(e.device) }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="a-muted a-small">No events in the last 30 minutes.</p>
          }
        </section>
      </div>
    } @else {
      <div class="live"><an-skeleton [height]="170" /><an-skeleton [height]="170" /></div>
    }
  `,
  styles: TAB_STYLES + `
    .live { display: grid; gap: 1rem; grid-template-columns: minmax(15rem, 1fr) 2fr; }
    @media (max-width: 760px) { .live { grid-template-columns: 1fr; } }
    .now .label { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--a-muted); }
    .big { margin: 0.2rem 0; font-size: 3.4rem; font-weight: 750; letter-spacing: -0.03em; line-height: 1.1; }
    .now p.a-small { margin: 0.15rem 0 0; }
    .dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--a-line-strong); }
    .dot--on { background: #12a150; box-shadow: 0 0 0 0 rgb(18 161 80 / 0.5); animation: pulse 1.8s infinite; }
    @keyframes pulse { 70% { box-shadow: 0 0 0 8px rgb(18 161 80 / 0); } 100% { box-shadow: 0 0 0 0 rgb(18 161 80 / 0); } }
    @media (prefers-reduced-motion: reduce) { .dot--on { animation: none; } }
    .devices { margin-top: 1.1rem; }
    .feed { list-style: none; margin: 0; padding: 0; display: grid; max-height: 26rem; overflow-y: auto; }
    .feed li { display: grid; grid-template-columns: 4.2rem minmax(0, 1fr) auto; gap: 0.75rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--a-line); font-size: 0.86rem; }
    .feed li:last-child { border-bottom: 0; }
    .feed time { color: var(--a-muted); font-variant-numeric: tabular-nums; }
    .feed .path { max-width: none; }
    .feed .path strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .meta { color: var(--a-muted); white-space: nowrap; font-size: 0.8rem; }
  `,
})
export class AnalyticsRealtime {
  private readonly store = inject(AnalyticsStore);
  protected readonly data = signal<Realtime | null>(null);
  protected readonly error = signal('');
  protected readonly paused = signal(false);
  protected readonly num = num;
  protected readonly clock = clock;
  protected readonly flag = flag;
  protected readonly countryName = countryName;
  protected readonly channelName = (k: string | null) => (k ? (CHANNEL_NAMES[k] ?? k) : 'Unknown');
  protected readonly deviceName = (k: string | null) => (k ? (DEVICE_NAMES[k] ?? k) : 'Unknown');

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') {
        this.paused.set(true);
      } else {
        this.paused.set(false);
        try {
          this.data.set(await this.store.realtime());
          this.error.set('');
        } catch {
          this.error.set('Live data could not be loaded. Retrying…');
        }
      }
      timer = setTimeout(tick, EVERY_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && this.paused()) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    inject(DestroyRef).onDestroy(() => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  protected rows(list: { name: string | null; visitors: number }[], label: (k: string | null) => string = (k) => k ?? 'Unknown') {
    return list.map((x) => ({ key: x.name ?? '', label: label(x.name), value: x.visitors }));
  }

  protected readonly countryRows = computed(() =>
    (this.data()?.countries ?? []).map((c) => ({ key: c.name ?? '', label: countryName(c.name), icon: flag(c.name), value: c.visitors })),
  );
}

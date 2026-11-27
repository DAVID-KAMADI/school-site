import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth';
import { report } from './analytics-shell';
import { AnalyticsStore, bucketLabel, CHANNEL_NAMES, num, pct, when, type Conversions, type EventsReport } from './analytics-data';
import { BarList, LineChart } from './charts';
import { Skeleton, TAB_STYLES } from './shared';

/** Built-in events the tracker records by itself. */
export const EVENT_HELP: Record<string, string> = {
  file_download: 'A document or file link was clicked (Downloads page, PDFs, forms).',
  contact_click: 'A phone, email or WhatsApp link was clicked.',
  outbound_click: 'A link to another website was clicked.',
  sign_up: 'An applicant account was created on /apply.',
  application_submitted: 'An application was submitted.',
};

/** Web analytics → Events & conversions: goals, funnels and every tracked event. */
@Component({
  selector: 'app-analytics-events',
  imports: [BarList, LineChart, Skeleton, RouterLink],
  template: `
    @if (conv.error() || events.error()) {
      <p class="a-alert a-alert--error" role="alert">{{ conv.error() || events.error() }}</p>
    }
    @if (conv.data(); as c) {
      <div class="two first">
        <section class="a-panel">
          <div class="panel-head">
            <div><h2>Goals</h2><p class="a-small a-muted">{{ num(c.total) }} conversions from {{ num(c.sessions) }} visits.</p></div>
            <div class="a-toolbar">
              <a class="a-btn a-btn--sm export" [href]="store.exportUrl('conversions')" download>CSV</a>
              @if (canManage()) {
                <a class="a-btn a-btn--sm" routerLink="/admin/analytics/settings">Manage goals</a>
              }
            </div>
          </div>
          <div class="a-table-wrap">
            <table class="a-table">
              <thead><tr><th scope="col">Goal</th><th scope="col">Counted when</th><th scope="col" class="num">Conversions</th><th scope="col" class="num">Rate</th></tr></thead>
              <tbody>
                @for (g of c.goals; track g.id) {
                  <tr [class.off]="!g.isActive">
                    <td>{{ g.name }}@if (!g.isActive) { <span class="a-badge">Paused</span> }</td>
                    <td class="a-small"><code>{{ g.eventName }}</code>@if (g.labelContains) { containing “{{ g.labelContains }}” }</td>
                    <td class="num">{{ num(g.conversions ?? 0) }}</td>
                    <td class="num">{{ pct(g.rate ?? 0) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="4" class="a-muted">No goals yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="a-panel">
          <div class="panel-head"><h2>Conversions per day</h2></div>
          <an-line-chart [series]="[{ name: 'Conversions', values: trendValues() }]" [labels]="trendLabels()" [longLabels]="trendLong()" [height]="220" ariaLabel="Conversions per day" />
        </section>
      </div>

      @for (f of c.funnels; track f.name) {
        <section class="a-panel funnel-panel">
          <div class="panel-head">
            <div><h2>Funnel: {{ f.name }}</h2><p class="a-small a-muted">Visits that went through each step in order (in the same visit).</p></div>
          </div>
          <ol class="funnel">
            @for (s of f.steps; track $index; let i = $index) {
              <li>
                <div class="funnel__bar"><span [style.width.%]="share(f.steps[0].sessions, s.sessions) * 100"></span></div>
                <div class="funnel__text">
                  <strong>{{ i + 1 }}. {{ s.label }}</strong>
                  <span class="a-small a-muted">{{ s.type === 'page' ? 'Page' : 'Event' }} <code>{{ s.value }}</code></span>
                </div>
                <div class="funnel__num">
                  <b>{{ num(s.sessions) }}</b>
                  @if (i > 0) {
                    <span class="a-small" [class.drop]="share(f.steps[i - 1].sessions, s.sessions) < 0.5">
                      {{ pct(share(f.steps[i - 1].sessions, s.sessions), 0) }} continued
                    </span>
                  }
                </div>
              </li>
            }
          </ol>
        </section>
      }

      <div class="two">
        <section class="a-panel">
          <div class="panel-head"><h2>Top converting pages</h2></div>
          <an-bar-list [rows]="pageRows()" empty="No conversions in this period." />
        </section>
        <section class="a-panel">
          <div class="panel-head"><h2>Sources of conversions</h2></div>
          <an-bar-list [rows]="sourceRows()" empty="No conversions in this period." />
        </section>
      </div>
    } @else if (conv.loading()) {
      <div class="two first"><an-skeleton [height]="240" /><an-skeleton [height]="240" /></div>
    }

    @if (events.data(); as e) {
      <div class="two">
        <section class="a-panel">
          <div class="panel-head">
            <div><h2>All events</h2><p class="a-small a-muted">Click an event to see its details.</p></div>
            <a class="a-btn a-btn--sm export" [href]="store.exportUrl('events')" download>CSV</a>
          </div>
          <div class="a-table-wrap">
            <table class="a-table">
              <thead><tr><th scope="col">Event</th><th scope="col">Category</th><th scope="col" class="num">Count</th><th scope="col" class="num">Visitors</th><th scope="col">Last</th></tr></thead>
              <tbody>
                @for (ev of e.events; track ev.name) {
                  <tr [class.sel]="selected() === ev.name">
                    <td><button type="button" class="row-btn" (click)="select(ev.name)" [title]="help(ev.name)">{{ ev.name }}</button></td>
                    <td class="a-small">{{ ev.category }}</td>
                    <td class="num">{{ num(ev.count) }}</td>
                    <td class="num">{{ num(ev.visitors) }}</td>
                    <td class="a-small a-muted">{{ when(ev.lastAt) }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="5" class="a-muted">No events in this period.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="a-panel">
          @if (selected(); as name) {
            <div class="panel-head">
              <div><h2><code>{{ name }}</code></h2><p class="a-small a-muted">{{ help(name) }}</p></div>
              <div class="a-toolbar">
                <button type="button" class="a-btn a-btn--sm" (click)="store.setFilter('event', name)">Filter dashboard by it</button>
                <button type="button" class="a-btn a-btn--sm" (click)="select(null)">Close</button>
              </div>
            </div>
            <h3>Most common</h3>
            <an-bar-list [rows]="labelRows()" [limit]="10" empty="No details recorded." />
            <h3 class="recent-h">Latest</h3>
            <ul class="feed">
              @for (r of e.recent; track $index) {
                <li><time>{{ when(r.occurredAt) }}</time><span>{{ r.label || '—' }}</span><small>{{ r.path }}</small></li>
              }
            </ul>
          } @else {
            <div class="panel-head"><h2>What is tracked</h2></div>
            <ul class="known a-small">
              @for (k of known; track k[0]) {
                <li><code>{{ k[0] }}</code> {{ k[1] }}</li>
              }
              <li>Plus any custom events added under Settings, and elements on the site with a <code>data-track="name"</code> attribute.</li>
            </ul>
          }
        </section>
      </div>
    }
  `,
  styles: TAB_STYLES + `
    .first { margin-top: 0; }
    .funnel-panel { margin-top: 1rem; }
    tr.off td { color: var(--a-muted); }
    tr.sel { background: var(--a-primary-soft); }
    .funnel { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
    .funnel li { display: grid; grid-template-columns: minmax(8rem, 2fr) minmax(10rem, 2fr) auto; gap: 1rem; align-items: center; }
    .funnel__bar { height: 1.6rem; background: #eef1f5; border-radius: 4px; overflow: hidden; }
    .funnel__bar span { display: block; height: 100%; background: #257de0; border-radius: 0 4px 4px 0; min-width: 2px; }
    .funnel__text { display: grid; }
    .funnel__num { display: grid; justify-items: end; font-variant-numeric: tabular-nums; }
    .funnel__num .drop { color: var(--a-danger); font-weight: 600; }
    @media (max-width: 700px) { .funnel li { grid-template-columns: 1fr auto; } .funnel__bar { grid-column: 1 / -1; } }
    h3 { font-size: 0.9rem; }
    .recent-h { margin-top: 1rem; }
    .feed { list-style: none; margin: 0; padding: 0; max-height: 16rem; overflow-y: auto; font-size: 0.84rem; }
    .feed li { display: grid; grid-template-columns: 7.5rem 1fr; column-gap: 0.75rem; padding: 0.4rem 0; border-bottom: 1px solid var(--a-line); }
    .feed time { color: var(--a-muted); grid-row: span 2; }
    .feed small { color: var(--a-muted); }
    .known { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.45rem; }
  `,
})
export class AnalyticsEvents {
  protected readonly store = inject(AnalyticsStore);
  private readonly auth = inject(AuthStore);
  protected readonly num = num;
  protected readonly pct = pct;
  protected readonly when = when;
  protected readonly known = Object.entries(EVENT_HELP);
  protected readonly canManage = computed(() => this.auth.canAny(['analytics.manage']));
  protected readonly selected = signal<string | null>(null);

  protected readonly conv = report(() => this.store.get<Conversions>('conversions'));
  protected readonly events = report(() => this.store.get<EventsReport>('events', { name: this.selected() ?? undefined }));

  constructor() {
    effect(() => {
      this.store.query();
      untracked(() => {
        void this.conv.run();
        void this.events.run();
      });
    });
  }

  protected select(name: string | null) {
    this.selected.set(name);
    void this.events.run();
  }

  protected help(name: string) {
    return EVENT_HELP[name] ?? 'Custom event.';
  }

  protected share(of: number, part: number) {
    return of ? Math.min(1, part / of) : 0;
  }

  protected readonly trendValues = computed(() => (this.conv.data()?.trend ?? []).map((t) => t.conversions));
  protected readonly trendLabels = computed(() => (this.conv.data()?.trend ?? []).map((t) => bucketLabel(t.bucket, 'day')));
  protected readonly trendLong = computed(() => (this.conv.data()?.trend ?? []).map((t) => bucketLabel(t.bucket, 'day', true)));
  protected readonly pageRows = computed(() => (this.conv.data()?.pages ?? []).map((p) => ({ key: p.path, label: p.path, value: p.conversions })));
  protected readonly sourceRows = computed(() =>
    (this.conv.data()?.sources ?? []).map((s) => ({
      key: `${s.channel}-${s.host}`,
      label: `${CHANNEL_NAMES[s.channel] ?? s.channel}${s.host ? ' · ' + s.host : ''}`,
      value: s.conversions,
    })),
  );
  protected readonly labelRows = computed(() =>
    (this.events.data()?.labels ?? []).map((l, i) => ({ key: String(i), label: l.label || '(no detail)', value: l.count })),
  );
}

import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { change, compact, countryName, num, pct } from './analytics-data';

/* Colours: validated reference palette (dataviz skill). Series 1 blue, series 2 orange; sequential = one blue ramp. */
export const SERIES = ['#257de0', '#f47230', '#00b894'];
export const RAMP = ['#cce3fd', '#9dc8f7', '#6aabf1', '#338ced', '#2370cd', '#1757ac', '#0e3d7e'];
const EMPTY = '#eef1f5';

/** A value's step on the sequential ramp (0 stays the empty colour). */
export function rampColor(value: number, max: number) {
  if (!value || !max) return EMPTY;
  const i = Math.min(RAMP.length - 1, Math.floor(Math.sqrt(value / max) * RAMP.length));
  return RAMP[i];
}

/** Nice round axis maximum and 4 ticks. */
function niceTicks(max: number) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const s = Math.max(step, max < 4 ? 1 : step);
  return { top: s * 4, ticks: [0, 1, 2, 3, 4].map((k) => k * s) };
}

/** Width of the host element, kept up to date. */
function useWidth(el: ElementRef<HTMLElement>, fallback = 640) {
  const width = signal(fallback);
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const destroy = inject(DestroyRef);
  afterNextRender(() => {
    if (!browser || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => width.set(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el.nativeElement);
    destroy.onDestroy(() => ro.disconnect());
  });
  return width;
}

export interface LineSeries {
  name: string;
  values: number[];
  color?: string;
}

// ---- KPI card ------------------------------------------------------------------------

@Component({
  selector: 'an-kpi',
  template: `
    <div class="kpi" [class.kpi--active]="active()">
      <p class="kpi__label">
        {{ label() }}
        @if (help()) {
          <span class="kpi__help" tabindex="0" [attr.aria-label]="help()" [attr.data-tip]="help()">?</span>
        }
      </p>
      <p class="kpi__value">{{ value() }}</p>
      @if (delta() !== undefined) {
        <p class="kpi__delta" [class.up]="good() === true" [class.down]="good() === false">
          @if (delta() === null) {
            <span class="a-muted">New this period</span>
          } @else {
            <span aria-hidden="true">{{ delta()! > 0 ? '▲' : delta()! < 0 ? '▼' : '■' }}</span>
            {{ deltaText() }} <span class="a-muted">vs previous</span>
          }
        </p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .kpi { height: 100%; box-sizing: border-box; padding: 1rem 1.1rem; background: var(--a-panel); border: 1px solid var(--a-line); border-radius: var(--a-radius); box-shadow: var(--a-shadow); }
    .kpi--active { border-color: var(--a-primary); box-shadow: var(--a-ring); }
    .kpi__label { margin: 0; font-size: 0.82rem; font-weight: 600; color: var(--a-muted); display: flex; align-items: center; gap: 0.35rem; }
    .kpi__value { margin: 0.3rem 0 0.2rem; font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.15; }
    .kpi__delta { margin: 0; font-size: 0.8rem; font-weight: 600; color: var(--a-muted); }
    .kpi__delta.up { color: var(--a-success); }
    .kpi__delta.down { color: var(--a-danger); }
    .kpi__help { position: relative; display: inline-grid; place-items: center; width: 1rem; height: 1rem; border-radius: 50%; border: 1px solid var(--a-line-strong); font-size: 0.65rem; cursor: help; }
    .kpi__help:hover::after, .kpi__help:focus::after {
      content: attr(data-tip); position: absolute; z-index: 20; left: 50%; top: 1.4rem; translate: -50% 0; width: 15rem;
      padding: 0.55rem 0.7rem; border-radius: 8px; background: #18202b; color: #fff; font-weight: 500; font-size: 0.78rem; line-height: 1.4;
    }
  `,
})
export class Kpi {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly current = input<number>(0);
  readonly previous = input<number | undefined>(undefined);
  /** Lower is better (bounce rate). */
  readonly invert = input(false);
  readonly help = input<string>('');
  readonly active = input(false);

  protected readonly delta = computed(() => (this.previous() === undefined ? undefined : change(this.current(), this.previous()!)));
  protected readonly deltaText = computed(() => {
    const d = this.delta();
    return d === null || d === undefined ? '' : `${Math.abs(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%`;
  });
  protected readonly good = computed(() => {
    const d = this.delta();
    if (d === null || d === undefined || d === 0) return null;
    return this.invert() ? d < 0 : d > 0;
  });
}

// ---- Line chart (with crosshair tooltip) ---------------------------------------------

@Component({
  selector: 'an-line-chart',
  template: `
    <div class="wrap">
      @if (series().length > 1) {
        <ul class="legend">
          @for (s of drawn(); track s.name) {
            <li><span class="swatch" [style.background]="s.color"></span>{{ s.name }}</li>
          }
        </ul>
      }
      <svg [attr.width]="width()" [attr.height]="height()" role="img" [attr.aria-label]="ariaLabel()"
           (pointermove)="hover($event)" (pointerleave)="active.set(null)">
        @for (t of axis().ticks; track t) {
          <line class="grid" [attr.x1]="pad.l" [attr.x2]="width() - pad.r" [attr.y1]="y(t)" [attr.y2]="y(t)" />
          <text class="tick" [attr.x]="pad.l - 8" [attr.y]="y(t) + 4" text-anchor="end">{{ fmtAxis(t) }}</text>
        }
        @for (l of xLabels(); track l.i) {
          <text class="tick" [attr.x]="x(l.i)" [attr.y]="height() - 6" text-anchor="middle">{{ l.text }}</text>
        }
        @for (s of drawn(); track s.name) {
          @if (s.area) {
            <path [attr.d]="s.area" [attr.fill]="s.color" opacity="0.08" />
          }
          <path [attr.d]="s.line" fill="none" [attr.stroke]="s.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        }
        @if (active() !== null) {
          <line class="cross" [attr.x1]="x(active()!)" [attr.x2]="x(active()!)" [attr.y1]="pad.t" [attr.y2]="height() - pad.b" />
          @for (s of drawn(); track s.name) {
            <circle [attr.cx]="x(active()!)" [attr.cy]="y(s.values[active()!])" r="4.5" [attr.fill]="s.color" stroke="#fff" stroke-width="2" />
          }
        }
      </svg>
      @if (active() !== null) {
        <div class="tip" [style.left.px]="tipLeft()" [style.top.px]="pad.t">
          <strong>{{ longLabels()[active()!] }}</strong>
          @for (s of drawn(); track s.name) {
            <span><i [style.background]="s.color"></i>{{ s.name }} <b>{{ format()(s.values[active()!]) }}</b></span>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .wrap { position: relative; }
    svg { display: block; overflow: visible; touch-action: pan-y; }
    .grid { stroke: var(--a-line); stroke-width: 1; }
    .tick { fill: var(--a-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .cross { stroke: var(--a-line-strong); stroke-width: 1; stroke-dasharray: 3 3; }
    .legend { display: flex; gap: 1rem; list-style: none; margin: 0 0 0.5rem; padding: 0; font-size: 0.82rem; color: var(--a-muted); }
    .legend li { display: flex; align-items: center; gap: 0.4rem; }
    .swatch { width: 0.75rem; height: 3px; border-radius: 2px; }
    .tip {
      position: absolute; pointer-events: none; z-index: 5; min-width: 9rem; display: grid; gap: 0.2rem;
      padding: 0.55rem 0.7rem; background: #fff; border: 1px solid var(--a-line); border-radius: 9px; box-shadow: var(--a-shadow-lg); font-size: 0.8rem;
    }
    .tip span { display: flex; align-items: center; gap: 0.4rem; color: var(--a-muted); }
    .tip b { margin-left: auto; padding-left: 0.75rem; color: var(--a-text); font-variant-numeric: tabular-nums; }
    .tip i { width: 0.6rem; height: 0.6rem; border-radius: 50%; }
  `,
})
export class LineChart {
  private readonly el = inject(ElementRef<HTMLElement>);
  readonly series = input.required<LineSeries[]>();
  /** Short labels for the axis and long ones for the tooltip, one per point. */
  readonly labels = input.required<string[]>();
  readonly longLabels = input.required<string[]>();
  readonly height = input(260);
  readonly format = input<(v: number) => string>(num);
  readonly ariaLabel = input('Chart');
  readonly area = input(true);

  protected readonly width = useWidth(this.el);
  protected readonly pad = { t: 10, r: 12, b: 26, l: 46 };
  protected readonly active = signal<number | null>(null);

  protected readonly axis = computed(() => niceTicks(Math.max(0, ...this.series().flatMap((s) => s.values))));
  protected readonly count = computed(() => this.labels().length);

  protected x(i: number) {
    const n = this.count();
    const w = this.width() - this.pad.l - this.pad.r;
    return this.pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  }
  protected y(v: number) {
    const h = this.height() - this.pad.t - this.pad.b;
    return this.pad.t + h - (v / this.axis().top) * h;
  }

  protected readonly drawn = computed(() => {
    this.width();
    return this.series().map((s, k) => {
      const color = s.color ?? SERIES[k % SERIES.length];
      const pts = s.values.map((v, i) => `${this.x(i).toFixed(1)},${this.y(v).toFixed(1)}`);
      const line = pts.length ? `M${pts.join('L')}` : '';
      const base = this.y(0).toFixed(1);
      const area = this.area() && this.series().length === 1 && pts.length > 1
        ? `${line}L${this.x(s.values.length - 1).toFixed(1)},${base}L${this.x(0).toFixed(1)},${base}Z`
        : '';
      return { name: s.name, values: s.values, color, line, area };
    });
  });

  /** About one label per 80 px. */
  protected readonly xLabels = computed(() => {
    const n = this.count();
    const room = Math.max(2, Math.floor((this.width() - this.pad.l - this.pad.r) / 80));
    const step = Math.max(1, Math.ceil(n / room));
    const out: { i: number; text: string }[] = [];
    for (let i = 0; i < n; i += step) out.push({ i, text: this.labels()[i] });
    return out;
  });

  protected readonly tipLeft = computed(() => {
    const i = this.active();
    if (i === null) return 0;
    const px = this.x(i);
    return px > this.width() - 180 ? px - 170 : px + 12;
  });

  protected fmtAxis = (v: number) => compact(v);

  protected hover(e: PointerEvent) {
    const n = this.count();
    if (!n) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const w = this.width() - this.pad.l - this.pad.r;
    const rel = (e.clientX - rect.left - this.pad.l) / (w || 1);
    this.active.set(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  }
}

// ---- Bar list (ranked breakdowns) ---------------------------------------------------

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** Secondary text on the right, e.g. "54% engaged". */
  note?: string;
  icon?: string;
}

@Component({
  selector: 'an-bar-list',
  template: `
    @if (!rows().length) {
      <p class="a-muted a-small empty">{{ empty() }}</p>
    } @else {
      <ul>
        @for (r of shown(); track r.key) {
          <li>
            <button type="button" [disabled]="!selectable()" (click)="pick.emit(r.key)" [title]="r.label + ': ' + format()(r.value) + ' (' + share(r.value) + ')'">
              <span class="bar" [style.width.%]="(r.value / max()) * 100"></span>
              <span class="name">@if (r.icon) {<span class="icon" aria-hidden="true">{{ r.icon }}</span>}{{ r.label }}</span>
              <span class="val">{{ format()(r.value) }}<small>{{ r.note ?? share(r.value) }}</small></span>
            </button>
          </li>
        }
      </ul>
      @if (rows().length > limit() && !all()) {
        <button type="button" class="a-link-btn more" (click)="all.set(true)">Show all {{ rows().length }}</button>
      }
    }
  `,
  styles: `
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    button:not(.more) {
      position: relative; width: 100%; display: flex; align-items: center; gap: 0.75rem; min-height: 2.15rem;
      padding: 0.3rem 0.6rem; border: 0; border-radius: 7px; background: none; font: inherit; color: var(--a-text); text-align: left; cursor: pointer;
    }
    button:disabled { cursor: default; }
    button:not(:disabled):hover { background: #f5f8fd; }
    .bar { position: absolute; left: 0; top: 3px; bottom: 3px; border-radius: 0 4px 4px 0; background: #dbe9fc; min-width: 2px; }
    .name { position: relative; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.88rem; }
    .icon { margin-right: 0.4rem; }
    .val { position: relative; display: flex; align-items: baseline; gap: 0.5rem; font-weight: 650; font-variant-numeric: tabular-nums; font-size: 0.88rem; }
    .val small { min-width: 3.2rem; text-align: right; font-weight: 500; color: var(--a-muted); font-size: 0.76rem; }
    .more { margin-top: 0.5rem; }
    .empty { margin: 0.5rem 0; }
  `,
})
export class BarList {
  readonly rows = input.required<BarRow[]>();
  readonly limit = input(8);
  readonly selectable = input(false);
  readonly format = input<(v: number) => string>(num);
  readonly empty = input('No data for this period.');
  readonly pick = output<string>();
  protected readonly all = signal(false);
  protected readonly total = computed(() => this.rows().reduce((a, r) => a + r.value, 0));
  protected readonly max = computed(() => Math.max(1, ...this.rows().map((r) => r.value)));
  protected readonly shown = computed(() => (this.all() ? this.rows() : this.rows().slice(0, this.limit())));
  protected share(v: number) {
    return this.total() ? pct(v / this.total(), 0) : '';
  }
}

// ---- Segmented bar (one whole split into parts: devices, new vs returning) ---------

@Component({
  selector: 'an-split-bar',
  template: `
    <div class="bar" role="img" [attr.aria-label]="aria()">
      @for (p of parts(); track p.label; let i = $index) {
        @if (p.value) {
          <span [style.flex-grow]="p.value" [style.background]="p.color ?? colors[i % colors.length]" [title]="p.label + ': ' + num(p.value) + ' (' + share(p.value) + ')'"></span>
        }
      }
    </div>
    <ul class="legend">
      @for (p of parts(); track p.label; let i = $index) {
        <li><i [style.background]="p.color ?? colors[i % colors.length]"></i>{{ p.label }} <b>{{ share(p.value) }}</b> <span class="a-muted">({{ num(p.value) }})</span></li>
      }
    </ul>
  `,
  styles: `
    .bar { display: flex; gap: 2px; height: 0.85rem; border-radius: 4px; overflow: hidden; background: ${EMPTY}; }
    .bar span { min-width: 3px; }
    .legend { list-style: none; margin: 0.6rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; font-size: 0.84rem; }
    .legend li { display: flex; align-items: center; gap: 0.4rem; }
    .legend i { width: 0.65rem; height: 0.65rem; border-radius: 3px; }
    b { font-variant-numeric: tabular-nums; }
  `,
})
export class SplitBar {
  readonly parts = input.required<{ label: string; value: number; color?: string }[]>();
  protected readonly colors = [...SERIES, '#f2a600', '#ee7fac', '#008a17', '#6a4ce2'];
  protected readonly num = num;
  protected readonly total = computed(() => this.parts().reduce((a, p) => a + p.value, 0));
  protected readonly aria = computed(() => this.parts().map((p) => `${p.label} ${this.share(p.value)}`).join(', '));
  protected share(v: number) {
    return this.total() ? pct(v / this.total(), 0) : '0%';
  }
}

// ---- Heatmap: sessions by weekday and hour -----------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Component({
  selector: 'an-heatmap',
  template: `
    <div class="heat" role="table" aria-label="Visits by day of week and hour">
      <span></span>
      @for (h of hours; track h) {
        <span class="h">{{ h % 3 === 0 ? h + 'h' : '' }}</span>
      }
      @for (d of days; track d; let wd = $index) {
        <span class="d">{{ d }}</span>
        @for (h of hours; track h) {
          <span class="cell" [style.background]="color(wd, h)" [title]="d + ' ' + h + ':00–' + (h + 1) + ':00 · ' + value(wd, h) + ' visits'"></span>
        }
      }
    </div>
    <p class="scale a-small a-muted">Fewer <span>@for (c of ramp; track c) {<i [style.background]="c"></i>}</span> More</p>
  `,
  styles: `
    .heat { display: grid; grid-template-columns: 2.4rem repeat(24, minmax(0, 1fr)); gap: 2px; align-items: center; }
    .h { font-size: 0.65rem; color: var(--a-muted); text-align: left; }
    .d { font-size: 0.75rem; color: var(--a-muted); }
    .cell { aspect-ratio: 1; border-radius: 3px; min-height: 0.7rem; }
    .scale { display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end; margin: 0.6rem 0 0; }
    .scale span { display: flex; gap: 2px; }
    .scale i { width: 0.8rem; height: 0.8rem; border-radius: 2px; }
  `,
})
export class Heatmap {
  readonly cells = input.required<{ weekday: number; hour: number; sessions: number }[]>();
  protected readonly days = DAYS;
  protected readonly hours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly ramp = RAMP;
  private readonly map = computed(() => new Map(this.cells().map((c) => [`${c.weekday}-${c.hour}`, c.sessions])));
  private readonly max = computed(() => Math.max(0, ...this.cells().map((c) => c.sessions)));
  protected value(wd: number, h: number) {
    return this.map().get(`${wd}-${h}`) ?? 0;
  }
  protected color(wd: number, h: number) {
    return rampColor(this.value(wd, h), this.max());
  }
}

// ---- Columns (real-time page views per minute) --------------------------------------

@Component({
  selector: 'an-columns',
  template: `
    <div class="cols" role="img" [attr.aria-label]="aria()">
      @for (v of values(); track $index; let i = $index) {
        <span class="col" [title]="title(i)"><i [style.height.%]="max() ? (v / max()) * 100 : 0"></i></span>
      }
    </div>
    <div class="axis a-small a-muted"><span>{{ values().length }} min ago</span><span>Now</span></div>
  `,
  styles: `
    .cols { display: flex; align-items: flex-end; gap: 2px; height: 5rem; }
    .col { flex: 1; height: 100%; display: flex; align-items: flex-end; }
    .col:hover i { background: var(--a-primary-strong); }
    i { display: block; width: 100%; min-height: 2px; border-radius: 3px 3px 0 0; background: #257de0; }
    .axis { display: flex; justify-content: space-between; margin-top: 0.3rem; }
  `,
})
export class Columns {
  readonly values = input.required<number[]>();
  protected readonly max = computed(() => Math.max(0, ...this.values()));
  protected readonly aria = computed(() => `Page views per minute over the last ${this.values().length} minutes`);
  protected title(i: number) {
    const ago = this.values().length - 1 - i;
    return `${ago ? ago + ' min ago' : 'This minute'}: ${this.values()[i]} page views`;
  }
}

// ---- World map (choropleth) ---------------------------------------------------------

interface WorldShape {
  width: number;
  height: number;
  countries: Record<string, string>;
}

let worldShape: Promise<WorldShape | null> | null = null;

@Component({
  selector: 'an-world-map',
  template: `
    <div class="map">
      @if (shape(); as s) {
        <svg [attr.viewBox]="'0 0 ' + s.width + ' ' + s.height" role="img" aria-label="Visitors by country">
          @for (c of paths(); track c.code) {
            <path [attr.d]="c.d" [attr.fill]="c.fill" [class.on]="c.value > 0"
                  (pointerenter)="hover.set(c.code)" (pointerleave)="hover.set(null)" (click)="c.value && pick.emit(c.code)">
              <title>{{ c.name }}: {{ c.value }} {{ unit() }}</title>
            </path>
          }
        </svg>
        @if (hover(); as h) {
          <p class="tip">{{ name(h) }} · <b>{{ valueOf(h) }}</b> {{ unit() }}</p>
        }
      } @else if (failed()) {
        <p class="a-muted a-small">The map could not be loaded.</p>
      } @else {
        <div class="skeleton"></div>
      }
    </div>
    <p class="scale a-small a-muted">Fewer <span>@for (c of ramp; track c) {<i [style.background]="c"></i>}</span> More</p>
  `,
  styles: `
    .map { position: relative; }
    svg { display: block; width: 100%; height: auto; }
    path { stroke: #fff; stroke-width: 0.5; transition: opacity 0.12s; }
    path.on { cursor: pointer; }
    path.on:hover { opacity: 0.8; stroke: #18202b; stroke-width: 0.8; }
    .tip { position: absolute; left: 0.5rem; bottom: 0.5rem; margin: 0; padding: 0.4rem 0.65rem; background: #fff; border: 1px solid var(--a-line); border-radius: 8px; box-shadow: var(--a-shadow); font-size: 0.85rem; }
    .skeleton { aspect-ratio: 2 / 1; border-radius: 10px; background: linear-gradient(90deg, #eef1f5, #f7f9fc, #eef1f5); background-size: 200% 100%; animation: sk 1.2s infinite linear; }
    @keyframes sk { to { background-position: -200% 0; } }
    .scale { display: flex; align-items: center; gap: 0.4rem; justify-content: flex-end; margin: 0.4rem 0 0; }
    .scale span { display: flex; gap: 2px; }
    .scale i { width: 0.8rem; height: 0.8rem; border-radius: 2px; }
  `,
})
export class WorldMap {
  readonly values = input.required<Record<string, number>>();
  readonly unit = input('visitors');
  readonly pick = output<string>();
  protected readonly ramp = RAMP;
  protected readonly shape = signal<WorldShape | null>(null);
  protected readonly failed = signal(false);
  protected readonly hover = signal<string | null>(null);

  constructor() {
    afterNextRender(() => {
      worldShape ??= fetch('/analytics/world-110m.json')
        .then((r) => (r.ok ? (r.json() as Promise<WorldShape>) : null))
        .catch(() => null);
      void worldShape.then((s) => (s ? this.shape.set(s) : this.failed.set(true)));
    });
  }

  private readonly max = computed(() => Math.max(0, ...Object.values(this.values())));
  protected readonly paths = computed(() => {
    const s = this.shape();
    if (!s) return [];
    const v = this.values();
    return Object.entries(s.countries).map(([code, d]) => ({
      code, d, value: v[code] ?? 0, name: countryName(code), fill: rampColor(v[code] ?? 0, this.max()),
    }));
  });
  protected name = countryName;
  protected valueOf(code: string) {
    return num(this.values()[code] ?? 0);
  }
}

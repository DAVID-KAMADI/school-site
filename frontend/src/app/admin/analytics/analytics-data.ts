import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Reports are in the institution's time zone (the API counts days the same way). */
export const ZONE = 'Africa/Nairobi';
const BASE = '/api/v1/admin/analytics';

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';
export type Interval = 'hour' | 'day' | 'week' | 'month';

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'custom', label: 'Custom range' },
];

export const CHANNEL_NAMES: Record<string, string> = {
  direct: 'Direct',
  organic: 'Organic search',
  social: 'Social media',
  referral: 'Other websites',
  email: 'Email',
  paid: 'Paid ads',
  other: 'Other (SMS, WhatsApp…)',
};

export interface Filters {
  channel?: string;
  country?: string;
  device?: string;
  path?: string;
  event?: string;
}

export interface Totals {
  visitors: number;
  sessions: number;
  pageViews: number;
  engagementRate: number;
  bounceRate: number;
  conversions: number;
  conversionRate: number;
  avgSessionDuration: number;
  avgEngagementTime: number;
  pagesPerSession: number;
  newVisitors: number;
  returningVisitors: number;
  unidentifiedVisitors: number;
}

export interface Overview {
  current: Totals;
  previous: Totals;
  hasData: boolean;
  previousRange: { from: string; to: string };
}

export interface SeriesPoint {
  bucket: string;
  visitors: number;
  sessions: number;
  pageViews: number;
  newVisitors: number;
  returningVisitors: number;
  conversions: number;
  engagementRate: number;
}

export interface Trends {
  interval: Interval;
  series: SeriesPoint[];
  heatmap: { weekday: number; hour: number; sessions: number }[];
}

export interface Metrics {
  visitors: number;
  sessions: number;
  pageViews: number;
  engagementRate: number;
  bounceRate: number;
  conversions: number;
  conversionRate: number;
}

export interface Realtime {
  at: string;
  activeVisitors: number;
  activeSessions: number;
  pages: { name: string | null; visitors: number }[];
  channels: { name: string | null; visitors: number }[];
  countries: { name: string | null; visitors: number }[];
  devices: { name: string | null; visitors: number }[];
  recentViews: { path: string; title: string | null; viewedAt: string; country: string | null; city: string | null; device: string; channel: string }[];
  recentEvents: { name: string; label: string | null; path: string; occurredAt: string; country: string | null; device: string }[];
  viewsPerMinute: number[];
}

export interface Acquisition {
  channels: (Metrics & { channel: string })[];
  referrers: (Metrics & { host: string })[];
  campaigns: (Metrics & { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null })[];
}

export interface Geography {
  countries: (Metrics & { country: string | null })[];
  cities: (Metrics & { country: string; region: string | null; city: string })[];
}

export interface PageRow {
  path: string;
  title: string | null;
  views: number;
  visitors: number;
  avgEngagementTime: number;
  entries: number;
  exits: number;
  bounceRate: number;
  conversions: number;
}

export interface Pages {
  total: number;
  page: number;
  size: number;
  rows: PageRow[];
}

export interface Devices {
  devices: (Metrics & { name: string | null })[];
  browsers: (Metrics & { name: string | null })[];
  systems: (Metrics & { name: string | null })[];
  screens: (Metrics & { name: string | null })[];
}

export interface EventsReport {
  events: { name: string; category: string; count: number; visitors: number; sessions: number; lastAt: string }[];
  labels: { label: string | null; count: number; visitors: number }[];
  recent: { name: string; category: string; label: string | null; path: string; occurredAt: string }[];
}

export interface Goal {
  id: number;
  name: string;
  eventName: string;
  labelContains: string | null;
  isActive: boolean;
  conversions?: number;
  rate?: number;
}

export interface FunnelStep {
  type: 'page' | 'event';
  value: string;
  label: string;
}

export interface Conversions {
  total: number;
  sessions: number;
  goals: Goal[];
  trend: { bucket: string; conversions: number }[];
  pages: { path: string; conversions: number }[];
  sources: { channel: string; host: string | null; conversions: number }[];
  funnels: { name: string; steps: (FunnelStep & { sessions: number })[] }[];
}

export interface CustomEventRule {
  name: string;
  type: 'click' | 'link' | 'page';
  value: string;
}

export interface Settings {
  enabled: boolean;
  respectDoNotTrack: boolean;
  retentionMonths: number;
  excludeStaff: boolean;
  excludedIps: string[];
  customEvents: CustomEventRule[];
  funnels: { name: string; steps: FunnelStep[] }[];
}

export interface SettingsResponse {
  settings: Settings;
  goals: Goal[];
  geo: { available: boolean; updatedAt: string | null; sizeMb: number | null; downloading: boolean; lastError: string | null };
}

const dayIn = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => dayIn.format(new Date());
export const addDays = (day: string, k: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

/**
 * The date range and filters shared by every Web analytics tab, and the calls to the API.
 * Kept while staff move between tabs.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsStore {
  private readonly http = inject(HttpClient);

  readonly preset = signal<Preset>('30d');
  readonly customFrom = signal(addDays(today(), -29));
  readonly customTo = signal(today());
  readonly filters = signal<Filters>({});

  readonly range = computed(() => {
    const t = today();
    switch (this.preset()) {
      case 'today':
        return { from: t, to: t };
      case 'yesterday':
        return { from: addDays(t, -1), to: addDays(t, -1) };
      case '7d':
        return { from: addDays(t, -6), to: t };
      case '90d':
        return { from: addDays(t, -89), to: t };
      case 'custom':
        return { from: this.customFrom(), to: this.customTo() };
      default:
        return { from: addDays(t, -29), to: t };
    }
  });

  /** Changes whenever the range or a filter changes: tabs reload on it. */
  readonly query = computed(() => ({ ...this.range(), ...this.filters() }));

  setFilter(key: keyof Filters, value: string | null | undefined) {
    this.filters.update((f) => {
      const next = { ...f };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  params(extra: Record<string, string | number | undefined> = {}) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries({ ...this.query(), ...extra })) if (v !== undefined && v !== '') p = p.set(k, String(v));
    return p;
  }

  get<T>(report: string, extra: Record<string, string | number | undefined> = {}) {
    return firstValueFrom(this.http.get<T>(`${BASE}/${report}`, { params: this.params(extra) }));
  }

  realtime() {
    return firstValueFrom(this.http.get<Realtime>(`${BASE}/realtime`));
  }

  exportUrl(report: string, extra: Record<string, string | number | undefined> = {}) {
    return `${BASE}/export?${this.params({ report, ...extra }).toString()}`;
  }

  settings() {
    return firstValueFrom(this.http.get<SettingsResponse>(`${BASE}/settings`));
  }

  saveSettings(s: Settings) {
    return firstValueFrom(this.http.put<Settings>(`${BASE}/settings`, s));
  }

  saveGoal(goal: Partial<Goal>) {
    return firstValueFrom(
      goal.id ? this.http.put<Goal>(`${BASE}/goals/${goal.id}`, goal) : this.http.post<Goal>(`${BASE}/goals`, goal),
    );
  }

  removeGoal(id: number) {
    return firstValueFrom(this.http.delete(`${BASE}/goals/${id}`));
  }

  updateGeo() {
    return firstValueFrom(this.http.post<SettingsResponse['geo']>(`${BASE}/geo/update`, {}));
  }
}

// ---- Formatting ----------------------------------------------------------------------

const int = new Intl.NumberFormat('en-GB');
const compactFmt = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
export const num = (v: number) => int.format(Math.round(v));
export const compact = (v: number) => (Math.abs(v) < 10_000 ? int.format(Math.round(v)) : compactFmt.format(v));
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(v === 0 || v === 1 ? 0 : digits)}%`;
export function duration(seconds: number) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(code: string | null | undefined) {
  if (!code) return 'Unknown';
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code: string | null | undefined) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "2026-11-27" / "2026-11-27 14:00" → a short axis label. */
export function bucketLabel(bucket: string, interval: Interval, long = false) {
  const d = new Date(`${bucket.slice(0, 10)}T00:00:00Z`);
  if (interval === 'hour') return `${long ? longDay.format(d) + ' ' : ''}${bucket.slice(11, 16)}`;
  if (interval === 'month') return monthFmt.format(d);
  if (interval === 'week') return `${long ? 'Week of ' : ''}${(long ? longDay : shortDay).format(d)}`;
  return (long ? longDay : shortDay).format(d);
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const clock = (iso: string) => timeFmt.format(new Date(iso));
export const when = (iso: string) => dateTimeFmt.format(new Date(iso));

/** Relative change, or null when there's nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return (current - previous) / previous;
}

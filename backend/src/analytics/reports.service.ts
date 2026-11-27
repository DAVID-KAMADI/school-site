import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AnalyticsSettingsService, type FunnelStep } from './analytics-settings.service.js';
import { CHANNELS } from './classify.js';

/** Days are counted in the institution's time zone (Kenya has no daylight saving, so a fixed offset works). */
const TIME_ZONE = process.env.SITE_TIME_ZONE || 'Africa/Nairobi';
function tzOffset(zone: string): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(part ?? '');
  return m ? `${m[1]}:${m[2] ?? '00'}` : '+00:00';
}
export const OFFSET = tzOffset(TIME_ZONE);
/** A UTC column shown as local time, for grouping by day or hour. */
const local = (col: string) => `CONVERT_TZ(${col}, '+00:00', '${OFFSET}')`;

/** Sessions seen in the last 5 minutes count as active now. */
const ACTIVE_MS = 5 * 60_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 731;

export type Interval = 'hour' | 'day' | 'week' | 'month';

export interface Range {
  /** Inclusive local dates. */
  from: string;
  to: string;
  start: Date;
  end: Date;
  days: number;
}

export interface Filters {
  channel?: string;
  country?: string;
  device?: string;
  /** Sessions that viewed this page. */
  path?: string;
  /** Sessions with this event. */
  event?: string;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const ratio = (a: number, b: number) => (b ? a / b : 0);
const bad = (message: string) => new BadRequestException({ message, code: 'VALIDATION' });

const localDate = (d: Date) => new Date(d.getTime() + offsetMs()).toISOString().slice(0, 10);
function offsetMs() {
  const [h, m] = OFFSET.split(':').map(Number);
  return Math.sign(h || 1) * (Math.abs(h) * 60 + (m || 0)) * 60_000;
}
const startOfLocalDay = (day: string) => new Date(`${day}T00:00:00${OFFSET}`);
const addDays = (day: string, k: number) => new Date(Date.parse(`${day}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

/** from/to as YYYY-MM-DD in local time (defaults: the last 30 days, today included). */
export function parseRange(q: Record<string, unknown>): Range {
  const today = localDate(new Date());
  const to = typeof q.to === 'string' && DAY.test(q.to) ? q.to : today;
  const from = typeof q.from === 'string' && DAY.test(q.from) ? q.from : addDays(to, -29);
  if (from > to) throw bad('The start date is after the end date.');
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(addDays(to, 1));
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) throw bad('Choose a range of up to two years.');
  return { from, to, start, end, days };
}

/** The same number of days just before the range, for comparisons. */
export function previousRange(r: Range): Range {
  const to = addDays(r.from, -1);
  const from = addDays(to, -(r.days - 1));
  return { from, to, start: startOfLocalDay(from), end: r.start, days: r.days };
}

export function parseFilters(q: Record<string, unknown>): Filters {
  const s = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const f: Filters = {
    channel: s(q.channel, 20),
    country: s(q.country, 2)?.toUpperCase(),
    device: s(q.device, 10),
    path: s(q.path, 300),
    event: s(q.event, 60),
  };
  if (f.channel && !CHANNELS.includes(f.channel as never)) throw bad('Unknown channel.');
  if (f.device && !['desktop', 'mobile', 'tablet'].includes(f.device)) throw bad('Unknown device.');
  return f;
}

/** WHERE clause for sessions (alias s) that started in the range and match the filters. */
function scope(r: Range, f: Filters, column = 's.started_at') {
  const where = [`${column} >= ?`, `${column} < ?`];
  const params: unknown[] = [r.start, r.end];
  if (f.channel) (where.push('s.channel = ?'), params.push(f.channel));
  if (f.country) (where.push('s.country = ?'), params.push(f.country));
  if (f.device) (where.push('s.device = ?'), params.push(f.device));
  if (f.path) (where.push('EXISTS (SELECT 1 FROM analytics_page_views fp WHERE fp.session_id = s.id AND fp.path = ?)'), params.push(f.path));
  if (f.event) (where.push('EXISTS (SELECT 1 FROM analytics_events fe WHERE fe.session_id = s.id AND fe.name = ?)'), params.push(f.event));
  return { where: where.join(' AND '), params };
}

const SESSION_METRICS = `
  COUNT(DISTINCT s.visitor_hash) visitors,
  COUNT(*) sessions,
  COALESCE(SUM(s.page_views), 0) pageViews,
  COALESCE(SUM(s.is_engaged), 0) engaged,
  COALESCE(SUM(s.conversions), 0) conversions,
  COALESCE(SUM(s.conversions > 0), 0) convertedSessions`;

function sessionMetrics(row: Record<string, unknown>) {
  const sessions = n(row.sessions);
  const engaged = n(row.engaged);
  return {
    visitors: n(row.visitors),
    sessions,
    pageViews: n(row.pageViews),
    engagementRate: ratio(engaged, sessions),
    bounceRate: sessions ? 1 - ratio(engaged, sessions) : 0,
    conversions: n(row.conversions),
    conversionRate: ratio(n(row.convertedSessions), sessions),
  };
}

/** Bucket key for a local date-time, matching the SQL below. */
function bucketSql(interval: Interval, col: string) {
  const t = local(col);
  switch (interval) {
    case 'hour':
      return `DATE_FORMAT(${t}, '%Y-%m-%d %H:00')`;
    case 'week':
      return `DATE_FORMAT(DATE_SUB(DATE(${t}), INTERVAL WEEKDAY(${t}) DAY), '%Y-%m-%d')`;
    case 'month':
      return `DATE_FORMAT(${t}, '%Y-%m-01')`;
    default:
      return `DATE_FORMAT(${t}, '%Y-%m-%d')`;
  }
}

/** Every bucket in the range, so days without visits show as 0 instead of being skipped. */
function buckets(r: Range, interval: Interval): string[] {
  const keys: string[] = [];
  if (interval === 'hour') {
    for (let d = r.from; d <= r.to; d = addDays(d, 1))
      for (let h = 0; h < 24; h++) keys.push(`${d} ${String(h).padStart(2, '0')}:00`);
    return keys;
  }
  if (interval === 'day') {
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) keys.push(d);
    return keys;
  }
  if (interval === 'week') {
    const first = new Date(`${r.from}T00:00:00Z`);
    let d = addDays(r.from, -((first.getUTCDay() + 6) % 7));
    for (; d <= r.to; d = addDays(d, 7)) keys.push(d);
    return keys;
  }
  let m = `${r.from.slice(0, 7)}-01`;
  while (m <= r.to) {
    keys.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`;
  }
  return keys;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DataSource,
    private readonly settings: AnalyticsSettingsService,
  ) {}

  private q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.db.query(sql, params) as Promise<T[]>;
  }

  /** True once any visit has been recorded, so the dashboard can show "no data yet" instead of zeros. */
  async hasData(): Promise<boolean> {
    return (await this.q('SELECT 1 FROM analytics_sessions LIMIT 1')).length > 0;
  }

  // ---- Overview ------------------------------------------------------------------------

  async overview(r: Range, f: Filters) {
    const [current, previous] = await Promise.all([this.totals(r, f), this.totals(previousRange(r), f)]);
    return { range: r, previousRange: previousRange(r), current, previous, hasData: await this.hasData() };
  }

  private async totals(r: Range, f: Filters) {
    const { where, params } = scope(r, f);
    const [row] = await this.q(
      `SELECT ${SESSION_METRICS},
              COALESCE(AVG(TIMESTAMPDIFF(SECOND, s.started_at, s.last_seen_at)), 0) avgDuration,
              COALESCE(AVG(s.engaged_ms), 0) avgEngagedMs,
              COUNT(DISTINCT CASE WHEN s.is_returning = 0 THEN s.visitor_hash END) newVisitors,
              COUNT(DISTINCT CASE WHEN s.is_returning = 1 THEN s.visitor_hash END) returningVisitors,
              COUNT(DISTINCT CASE WHEN s.is_returning IS NULL THEN s.visitor_hash END) unidentifiedVisitors
         FROM analytics_sessions s WHERE ${where}`,
      params,
    );
    const m = sessionMetrics(row);
    return {
      ...m,
      avgSessionDuration: Math.round(n(row.avgDuration)),
      avgEngagementTime: Math.round(n(row.avgEngagedMs) / 1000),
      pagesPerSession: ratio(m.pageViews, m.sessions),
      newVisitors: n(row.newVisitors),
      returningVisitors: n(row.returningVisitors),
      unidentifiedVisitors: n(row.unidentifiedVisitors),
    };
  }

  // ---- Trends --------------------------------------------------------------------------

  async trends(r: Range, f: Filters, interval: Interval) {
    if (interval === 'hour' && r.days > 14) interval = 'day';
    const { where, params } = scope(r, f);
    const key = bucketSql(interval, 's.started_at');
    const rows = await this.q(
      `SELECT ${key} bucket, ${SESSION_METRICS},
              COUNT(DISTINCT CASE WHEN s.is_returning = 0 THEN s.visitor_hash END) newVisitors,
              COUNT(DISTINCT CASE WHEN s.is_returning = 1 THEN s.visitor_hash END) returningVisitors
         FROM analytics_sessions s WHERE ${where} GROUP BY bucket`,
      params,
    );
    const byKey = new Map(rows.map((row) => [String(row.bucket), row]));
    const series = buckets(r, interval).map((bucket) => {
      const row = byKey.get(bucket) ?? {};
      return { bucket, ...sessionMetrics(row), newVisitors: n(row.newVisitors), returningVisitors: n(row.returningVisitors) };
    });

    // When people visit: sessions by weekday (0 = Monday) and hour, local time.
    const heat = await this.q(
      `SELECT WEEKDAY(${local('s.started_at')}) wd, HOUR(${local('s.started_at')}) h, COUNT(*) sessions
         FROM analytics_sessions s WHERE ${where} GROUP BY wd, h`,
      params,
    );
    return {
      interval,
      series,
      heatmap: heat.map((h) => ({ weekday: n(h.wd), hour: n(h.h), sessions: n(h.sessions) })),
    };
  }

  // ---- Real time -----------------------------------------------------------------------

  async realtime() {
    const since = new Date(Date.now() - ACTIVE_MS);
    const halfHour = new Date(Date.now() - 30 * 60_000);
    const group = (col: string, limit = 10) =>
      this.q(
        `SELECT ${col} name, COUNT(DISTINCT visitor_hash) visitors FROM analytics_sessions
          WHERE last_seen_at >= ? GROUP BY ${col} ORDER BY visitors DESC LIMIT ${limit}`,
        [since],
      );
    const [[totals], pages, channels, countries, devices, recentViews, recentEvents, perMinute] = await Promise.all([
      this.q('SELECT COUNT(DISTINCT visitor_hash) visitors, COUNT(*) sessions FROM analytics_sessions WHERE last_seen_at >= ?', [since]),
      group('exit_path', 15),
      group('channel'),
      group('country'),
      group('device'),
      this.q(
        `SELECT pv.path, pv.title, pv.viewed_at viewedAt, s.country, s.city, s.device, s.channel
           FROM analytics_page_views pv JOIN analytics_sessions s ON s.id = pv.session_id
          WHERE pv.viewed_at >= ? ORDER BY pv.id DESC LIMIT 25`,
        [halfHour],
      ),
      this.q(
        `SELECT e.name, e.label, e.path, e.occurred_at occurredAt, s.country, s.device
           FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id
          WHERE e.occurred_at >= ? ORDER BY e.id DESC LIMIT 15`,
        [halfHour],
      ),
      this.q(
        `SELECT FLOOR(TIMESTAMPDIFF(SECOND, viewed_at, ?) / 60) ago, COUNT(*) views
           FROM analytics_page_views WHERE viewed_at >= ? GROUP BY ago`,
        [new Date(), halfHour],
      ),
    ]);
    const minutes = Array.from({ length: 30 }, (_, i) => n(perMinute.find((m) => n(m.ago) === 29 - i)?.views));
    const list = (rows: Record<string, unknown>[]) => rows.map((x) => ({ name: x.name as string | null, visitors: n(x.visitors) }));
    return {
      at: new Date(),
      activeVisitors: n(totals?.visitors),
      activeSessions: n(totals?.sessions),
      pages: list(pages),
      channels: list(channels),
      countries: list(countries),
      devices: list(devices),
      recentViews,
      recentEvents,
      viewsPerMinute: minutes,
    };
  }

  // ---- Acquisition ---------------------------------------------------------------------

  async acquisition(r: Range, f: Filters) {
    const { where, params } = scope(r, f);
    const grouped = (cols: string, extra = '', limit = 100) =>
      this.q(`SELECT ${cols}, ${SESSION_METRICS} FROM analytics_sessions s WHERE ${where} ${extra} GROUP BY ${cols} ORDER BY sessions DESC LIMIT ${limit}`, params);
    const [channels, referrers, campaigns] = await Promise.all([
      grouped('s.channel'),
      grouped('s.referrer_host', 'AND s.referrer_host IS NOT NULL'),
      grouped(
        's.utm_source, s.utm_medium, s.utm_campaign, s.utm_term, s.utm_content',
        'AND (s.utm_source IS NOT NULL OR s.utm_medium IS NOT NULL OR s.utm_campaign IS NOT NULL)',
      ),
    ]);
    return {
      channels: channels.map((c) => ({ channel: c.channel, ...sessionMetrics(c) })),
      referrers: referrers.map((c) => ({ host: c.referrer_host, ...sessionMetrics(c) })),
      campaigns: campaigns.map((c) => ({
        source: c.utm_source, medium: c.utm_medium, campaign: c.utm_campaign, term: c.utm_term, content: c.utm_content,
        ...sessionMetrics(c),
      })),
    };
  }

  // ---- Geography -----------------------------------------------------------------------

  async geography(r: Range, f: Filters) {
    const { where, params } = scope(r, f);
    const [countries, cities] = await Promise.all([
      this.q(`SELECT s.country, ${SESSION_METRICS} FROM analytics_sessions s WHERE ${where} GROUP BY s.country ORDER BY sessions DESC`, params),
      this.q(
        `SELECT s.country, s.region, s.city, ${SESSION_METRICS} FROM analytics_sessions s
          WHERE ${where} AND s.city IS NOT NULL GROUP BY s.country, s.region, s.city ORDER BY sessions DESC LIMIT 100`,
        params,
      ),
    ]);
    return {
      countries: countries.map((c) => ({ country: c.country as string | null, ...sessionMetrics(c) })),
      cities: cities.map((c) => ({ country: c.country, region: c.region, city: c.city, ...sessionMetrics(c) })),
    };
  }

  // ---- Pages ---------------------------------------------------------------------------

  async pages(r: Range, f: Filters, q: Record<string, unknown>) {
    const sorts: Record<string, string> = {
      views: 'views', visitors: 'visitors', time: 'avgEngagedMs', entries: 'entries', path: 'pv.path',
    };
    const sort = sorts[String(q.sort)] ?? 'views';
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const size = Math.min(Math.max(Number(q.size) || 25, 5), 100);
    const page = Math.max(Number(q.page) || 1, 1);
    const search = typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '';

    const { where, params } = scope(r, f, 'pv.viewed_at');
    const searchSql = search ? ' AND (pv.path LIKE ? OR pv.title LIKE ?)' : '';
    const searchParams = search ? [`%${search}%`, `%${search}%`] : [];
    const from = `FROM analytics_page_views pv JOIN analytics_sessions s ON s.id = pv.session_id WHERE ${where}${searchSql}`;

    const [[count], rows] = await Promise.all([
      this.q(`SELECT COUNT(DISTINCT pv.path) total ${from}`, [...params, ...searchParams]),
      this.q(
        `SELECT pv.path, MAX(pv.title) title, COUNT(*) views, COUNT(DISTINCT s.visitor_hash) visitors,
                AVG(pv.engaged_ms) avgEngagedMs, SUM(pv.is_entry) entries
           ${from} GROUP BY pv.path ORDER BY ${sort} ${dir}, pv.path LIMIT ${size} OFFSET ${(page - 1) * size}`,
        [...params, ...searchParams],
      ),
    ]);

    const paths = rows.map((x) => x.path as string);
    const extra = paths.length ? await this.pageExtras(r, f, paths) : new Map<string, { exits: number; bounces: number; entrySessions: number; conversions: number }>();
    return {
      total: n(count?.total),
      page,
      size,
      rows: rows.map((x) => {
        const e = extra.get(x.path as string) ?? { exits: 0, bounces: 0, entrySessions: 0, conversions: 0 };
        return {
          path: x.path,
          title: x.title,
          views: n(x.views),
          visitors: n(x.visitors),
          avgEngagementTime: Math.round(n(x.avgEngagedMs) / 1000),
          entries: n(x.entries),
          exits: e.exits,
          bounceRate: ratio(e.bounces, e.entrySessions),
          conversions: e.conversions,
        };
      }),
    };
  }

  /** Exits, bounces (of sessions that started on the page) and conversions on the page, for a page of rows. */
  private async pageExtras(r: Range, f: Filters, paths: string[]) {
    const { where, params } = scope(r, f);
    const [exits, entries, conversions] = await Promise.all([
      this.q(`SELECT s.exit_path path, COUNT(*) n FROM analytics_sessions s WHERE ${where} AND s.exit_path IN (?) GROUP BY s.exit_path`, [...params, paths]),
      this.q(
        `SELECT s.entry_path path, COUNT(*) n, SUM(s.is_engaged = 0) bounces FROM analytics_sessions s
          WHERE ${where} AND s.entry_path IN (?) GROUP BY s.entry_path`,
        [...params, paths],
      ),
      this.q(
        `SELECT c.path, COUNT(*) n FROM analytics_conversions c JOIN analytics_sessions s ON s.id = c.session_id
          WHERE ${where} AND c.path IN (?) GROUP BY c.path`,
        [...params, paths],
      ),
    ]);
    const map = new Map<string, { exits: number; bounces: number; entrySessions: number; conversions: number }>();
    const get = (p: string) => map.get(p) ?? (map.set(p, { exits: 0, bounces: 0, entrySessions: 0, conversions: 0 }), map.get(p)!);
    for (const x of exits) get(x.path as string).exits = n(x.n);
    for (const x of entries) Object.assign(get(x.path as string), { entrySessions: n(x.n), bounces: n(x.bounces) });
    for (const x of conversions) get(x.path as string).conversions = n(x.n);
    return map;
  }

  // ---- Devices -------------------------------------------------------------------------

  async devices(r: Range, f: Filters) {
    const { where, params } = scope(r, f);
    const by = (col: string) =>
      this.q(`SELECT ${col} name, ${SESSION_METRICS} FROM analytics_sessions s WHERE ${where} GROUP BY ${col} ORDER BY sessions DESC LIMIT 20`, params)
        .then((rows) => rows.map((x) => ({ name: x.name as string | null, ...sessionMetrics(x) })));
    const [devices, browsers, systems, screens] = await Promise.all([by('s.device'), by('s.browser'), by('s.os'), by('s.screen')]);
    return { devices, browsers, systems, screens };
  }

  // ---- Events --------------------------------------------------------------------------

  async events(r: Range, f: Filters, q: Record<string, unknown>) {
    const { where, params } = scope(r, f, 'e.occurred_at');
    const from = `FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id WHERE ${where}`;
    const name = typeof q.name === 'string' && q.name ? q.name.slice(0, 60) : null;
    const [events, labels, recent] = await Promise.all([
      this.q(
        `SELECT e.name, MAX(e.category) category, COUNT(*) count, COUNT(DISTINCT s.visitor_hash) visitors,
                COUNT(DISTINCT e.session_id) sessions, MAX(e.occurred_at) lastAt
           ${from} GROUP BY e.name ORDER BY count DESC LIMIT 100`,
        params,
      ),
      name
        ? this.q(
            `SELECT e.label, COUNT(*) count, COUNT(DISTINCT s.visitor_hash) visitors ${from} AND e.name = ?
              GROUP BY e.label ORDER BY count DESC LIMIT 50`,
            [...params, name],
          )
        : Promise.resolve([]),
      this.q(
        `SELECT e.name, e.category, e.label, e.path, e.occurred_at occurredAt ${from}${name ? ' AND e.name = ?' : ''}
          ORDER BY e.id DESC LIMIT 50`,
        name ? [...params, name] : params,
      ),
    ]);
    return {
      events: events.map((x) => ({ name: x.name, category: x.category, count: n(x.count), visitors: n(x.visitors), sessions: n(x.sessions), lastAt: x.lastAt })),
      labels: labels.map((x) => ({ label: x.label, count: n(x.count), visitors: n(x.visitors) })),
      recent,
    };
  }

  // ---- Conversions ---------------------------------------------------------------------

  async conversions(r: Range, f: Filters) {
    const { where, params } = scope(r, f, 'c.occurred_at');
    const from = `FROM analytics_conversions c JOIN analytics_sessions s ON s.id = c.session_id WHERE ${where}`;
    const [[sessions], goals, trend, pages, sources] = await Promise.all([
      this.q(`SELECT COUNT(*) n FROM analytics_sessions s WHERE ${scope(r, f).where}`, scope(r, f).params),
      this.q(
        `SELECT g.id, g.name, g.event_name eventName, g.label_contains labelContains, g.is_active isActive, COUNT(c.id) conversions
           FROM analytics_goals g
           LEFT JOIN (SELECT c.id, c.goal_id ${from}) c ON c.goal_id = g.id
          GROUP BY g.id ORDER BY g.sort_order, g.id`,
        params,
      ),
      this.q(`SELECT ${bucketSql('day', 'c.occurred_at')} bucket, COUNT(*) n ${from} GROUP BY bucket`, params),
      this.q(`SELECT c.path, COUNT(*) n ${from} GROUP BY c.path ORDER BY n DESC LIMIT 15`, params),
      this.q(`SELECT s.channel, s.referrer_host host, COUNT(*) n ${from} GROUP BY s.channel, s.referrer_host ORDER BY n DESC LIMIT 15`, params),
    ]);
    const total = goals.reduce((a, g) => a + n(g.conversions), 0);
    const byDay = new Map(trend.map((t) => [String(t.bucket), n(t.n)]));
    return {
      total,
      sessions: n(sessions?.n),
      goals: goals.map((g) => ({
        id: n(g.id), name: g.name, eventName: g.eventName, labelContains: g.labelContains, isActive: !!n(g.isActive),
        conversions: n(g.conversions), rate: ratio(n(g.conversions), n(sessions?.n)),
      })),
      trend: buckets(r, 'day').map((bucket) => ({ bucket, conversions: byDay.get(bucket) ?? 0 })),
      pages: pages.map((p) => ({ path: p.path, conversions: n(p.n) })),
      sources: sources.map((p) => ({ channel: p.channel, host: p.host, conversions: n(p.n) })),
      funnels: await this.funnels(r, f),
    };
  }

  /** For each funnel: how many sessions reached each step, in order (each step after the one before). */
  private async funnels(r: Range, f: Filters) {
    const { funnels } = await this.settings.get();
    const { where, params } = scope(r, f);
    const out = [];
    for (const funnel of funnels) {
      let reached: Map<string, number> | null = null; // session id → time of the step reached
      const steps: { label: string; type: string; value: string; sessions: number }[] = [];
      for (const step of funnel.steps) {
        const hits = await this.stepHits(step, where, params);
        const next = new Map<string, number>();
        for (const [session, times] of hits) {
          const after: number | undefined = reached ? reached.get(session) : -Infinity;
          if (after === undefined) continue;
          const t = times.find((x) => x >= after);
          if (t !== undefined) next.set(session, t);
        }
        reached = next;
        steps.push({ label: step.label, type: step.type, value: step.value, sessions: next.size });
      }
      out.push({ name: funnel.name, steps });
    }
    return out;
  }

  private async stepHits(step: FunnelStep, where: string, params: unknown[]) {
    const rows =
      step.type === 'page'
        ? await this.q<{ sid: string; t: Date }>(
            `SELECT pv.session_id sid, pv.viewed_at t FROM analytics_page_views pv JOIN analytics_sessions s ON s.id = pv.session_id
              WHERE ${where} AND (pv.path = ? OR pv.path LIKE ?) ORDER BY pv.viewed_at LIMIT 200000`,
            [...params, step.value, `${step.value.replace(/\/$/, '').replace(/[%_]/g, '\\$&')}/%`],
          )
        : await this.q<{ sid: string; t: Date }>(
            `SELECT e.session_id sid, e.occurred_at t FROM analytics_events e JOIN analytics_sessions s ON s.id = e.session_id
              WHERE ${where} AND e.name = ? ORDER BY e.occurred_at LIMIT 200000`,
            [...params, step.value],
          );
    const map = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(row.sid);
      const list = map.get(key) ?? (map.set(key, []), map.get(key)!);
      list.push(new Date(row.t).getTime());
    }
    return map;
  }
}

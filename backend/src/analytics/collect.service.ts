import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AnalyticsSettingsService, EVENT_NAME, ipExcluded } from './analytics-settings.service.js';
import {
  channelFor,
  isBot,
  normalisePath,
  parseUserAgent,
  referrerHost,
  screenCategory,
  text,
} from './classify.js';
import { GeoService } from './geo.service.js';

/** A visit ends after 30 minutes without activity. */
export const SESSION_GAP_MS = 30 * 60_000;
/** 10 seconds on the site counts as engaged (not a bounce). */
const ENGAGED_MS = 10_000;
/** Longest time one page view can add (a tab left open all day is not 8 hours of reading). */
const MAX_PAGE_MS = 30 * 60_000;
const MAX_ITEMS = 25;

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const HEX = /^[0-9a-f]{16,64}$/;

export interface CollectContext {
  ip: string | null;
  userAgent: string;
  doNotTrack: boolean;
  isStaff: boolean;
}

interface SessionRow {
  id: string;
  page_views: number;
  events: number;
  engaged_ms: number;
}

interface Goal {
  id: number;
  eventName: string;
  labelContains: string | null;
}

/**
 * Ingestion: turns what the website's tracker sends into sessions, page views, events and conversions.
 * Everything is validated; anything odd is dropped quietly, because a visitor's page must never break
 * over analytics. Stores categories only: no address, user-agent string, query string or form content.
 */
@Injectable()
export class CollectService {
  private readonly log = new Logger('Analytics');
  private goals: { list: Goal[]; at: number } | null = null;
  /** One request at a time per visitor, so two tabs starting together don't make two sessions. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: DataSource,
    private readonly settings: AnalyticsSettingsService,
    private readonly geo: GeoService,
  ) {}

  /** Returns the ids of new page views, in order, so the tracker can report time spent on them. */
  async collect(body: unknown, ctx: CollectContext): Promise<{ pv: (string | null)[] }> {
    const none = { pv: [] };
    if (!body || typeof body !== 'object') return none;
    const b = body as Record<string, unknown>;
    const items = Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : [];
    if (!items.length) return none;

    const settings = await this.settings.get();
    if (!settings.enabled) return none;
    if (settings.respectDoNotTrack && ctx.doNotTrack) return none;
    if (settings.excludeStaff && ctx.isStaff) return none;
    if (isBot(ctx.userAgent) || b.wd === true) return none;
    if (ipExcluded(ctx.ip, settings.excludedIps)) return none;

    // Recognised visitor (accepted all cookies): a random ID kept by their browser. Otherwise the tracker's
    // in-memory ID for this page load: nothing stored on the device, and nothing derived from the address.
    const vid = typeof b.v === 'string' && HEX.test(b.v) ? b.v : null;
    const tab = typeof b.s === 'string' && HEX.test(b.s) ? b.s : null;
    if (!vid && !tab) return none;
    const visitorKey = vid ? sha(`v:${vid}`).slice(0, 32) : null;
    const visitorHash = visitorKey ? visitorKey.slice(0, 16) : sha(`s:${tab}`).slice(0, 16);

    const run = async () => {
      const pv: (string | null)[] = [];
      let session: SessionRow | null = null;
      const now = new Date();
      for (const raw of items) {
        const item = (raw ?? {}) as Record<string, unknown>;
        try {
          if (item.t === 'pageview') {
            const path = normalisePath(item.path);
            if (!path) {
              pv.push(null);
              continue;
            }
            session ??= await this.findSession(visitorHash, now);
            if (!session) session = await this.startSession(item, path, visitorHash, visitorKey, ctx, now);
            pv.push(await this.pageView(session, item, path, now));
          } else if (item.t === 'engage' || item.t === 'event') {
            session ??= await this.findSession(visitorHash, now);
            if (!session) continue; // a late report after the visit ended
            if (item.t === 'engage') await this.engage(session, item, now);
            else await this.event(session, item, now);
          }
        } catch (e) {
          this.log.warn(`Analytics item dropped: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { pv };
    };

    const previous = this.locks.get(visitorHash) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.locks.set(visitorHash, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(visitorHash) === next) this.locks.delete(visitorHash);
    }
  }

  private async findSession(visitorHash: string, now: Date): Promise<SessionRow | null> {
    const [row] = (await this.db.query(
      `SELECT id, page_views, events, engaged_ms FROM analytics_sessions
        WHERE visitor_hash = ? AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 1`,
      [visitorHash, new Date(now.getTime() - SESSION_GAP_MS)],
    )) as SessionRow[];
    return row ? { ...row, id: String(row.id), page_views: Number(row.page_views), events: Number(row.events), engaged_ms: Number(row.engaged_ms) } : null;
  }

  private async startSession(
    item: Record<string, unknown>,
    path: string,
    visitorHash: string,
    visitorKey: string | null,
    ctx: CollectContext,
    now: Date,
  ): Promise<SessionRow> {
    let visitorId: string | null = null;
    let returning: boolean | null = null;
    if (visitorKey) {
      const [existing] = (await this.db.query('SELECT id FROM analytics_visitors WHERE visitor_key = ?', [visitorKey])) as { id: string }[];
      if (existing) {
        visitorId = String(existing.id);
        returning = true;
        await this.db.query('UPDATE analytics_visitors SET last_seen_at = ?, sessions = sessions + 1 WHERE id = ?', [now, visitorId]);
      } else {
        const r = (await this.db.query(
          'INSERT INTO analytics_visitors (visitor_key, first_seen_at, last_seen_at, sessions) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), last_seen_at = VALUES(last_seen_at)',
          [visitorKey, now, now],
        )) as { insertId: number };
        visitorId = String(r.insertId);
        returning = false;
      }
    }

    const utmRaw = (item.utm ?? {}) as Record<string, unknown>;
    const utm = {
      source: text(utmRaw.source, 100),
      medium: text(utmRaw.medium, 100),
      campaign: text(utmRaw.campaign, 150),
      term: text(utmRaw.term, 150),
      content: text(utmRaw.content, 150),
    };
    const host = referrerHost(item.ref);
    const agent = parseUserAgent(ctx.userAgent);
    const geo = this.geo.lookup(ctx.ip);

    const r = (await this.db.query(
      `INSERT INTO analytics_sessions
         (visitor_hash, visitor_id, is_returning, started_at, last_seen_at, entry_path, exit_path, referrer_host, channel,
          utm_source, utm_medium, utm_campaign, utm_term, utm_content, country, region, city, device, browser, os, screen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        visitorHash, visitorId, returning, now, now, path, path, host, channelFor(host, utm),
        utm.source, utm.medium, utm.campaign, utm.term, utm.content,
        geo.country, geo.region, geo.city, agent.device, agent.browser, agent.os, screenCategory(item.sw),
      ],
    )) as { insertId: number };
    return { id: String(r.insertId), page_views: 0, events: 0, engaged_ms: 0 };
  }

  private async pageView(session: SessionRow, item: Record<string, unknown>, path: string, now: Date) {
    const entry = session.page_views === 0;
    const r = (await this.db.query(
      'INSERT INTO analytics_page_views (session_id, path, title, viewed_at, is_entry) VALUES (?, ?, ?, ?, ?)',
      [session.id, path, text(item.title, 200), now, entry],
    )) as { insertId: number };
    session.page_views++;
    await this.db.query(
      `UPDATE analytics_sessions SET page_views = page_views + 1, exit_path = ?, last_seen_at = ?,
              is_engaged = (is_engaged OR page_views >= 2) WHERE id = ?`,
      [path, now, session.id],
    );
    // Custom "page" events and goals based on page visits are matched like any other event.
    const rules = (await this.settings.get()).customEvents.filter((c) => c.type === 'page' && path.startsWith(c.value));
    for (const rule of rules) await this.event(session, { name: rule.name, category: 'page', label: path, path }, now);
    return String(r.insertId);
  }

  /** Time spent on a page, reported when the visitor leaves it (and every 30 s while they read). */
  private async engage(session: SessionRow, item: Record<string, unknown>, now: Date) {
    const pvId = typeof item.pv === 'string' && /^\d{1,20}$/.test(item.pv) ? item.pv : null;
    const ms = Math.min(Math.max(Math.round(Number(item.ms) || 0), 0), MAX_PAGE_MS);
    if (!pvId) return;
    // Only a page view of this same session: nobody can add time to someone else's visit.
    const [row] = (await this.db.query('SELECT engaged_ms FROM analytics_page_views WHERE id = ? AND session_id = ?', [pvId, session.id])) as { engaged_ms: number }[];
    if (!row) return;
    const delta = Math.max(ms - Number(row.engaged_ms), 0);
    if (delta) await this.db.query('UPDATE analytics_page_views SET engaged_ms = ? WHERE id = ?', [ms, pvId]);
    session.engaged_ms += delta;
    await this.db.query(
      `UPDATE analytics_sessions SET engaged_ms = engaged_ms + ?, last_seen_at = ?,
              is_engaged = (is_engaged OR engaged_ms >= ?) WHERE id = ?`,
      [delta, now, ENGAGED_MS, session.id],
    );
  }

  private async event(session: SessionRow, item: Record<string, unknown>, now: Date) {
    const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : '';
    if (!EVENT_NAME.test(name) || name === 'pageview') return;
    const path = normalisePath(item.path) ?? '/';
    const label = text(item.label, 200);
    const clientId = typeof item.cid === 'string' && /^[0-9a-f]{16}$/.test(item.cid) ? item.cid : null;
    const r = (await this.db.query(
      'INSERT IGNORE INTO analytics_events (session_id, client_id, name, category, label, path, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [session.id, clientId, name, text(item.category, 40) ?? 'custom', label, path, now],
    )) as { affectedRows: number };
    if (!r.affectedRows) return; // sent twice
    session.events++;
    await this.db.query('UPDATE analytics_sessions SET events = events + 1, is_engaged = 1, last_seen_at = ? WHERE id = ?', [now, session.id]);

    for (const goal of await this.activeGoals()) {
      if (goal.eventName !== name) continue;
      if (goal.labelContains && !(label ?? '').toLowerCase().includes(goal.labelContains.toLowerCase())) continue;
      const c = (await this.db.query(
        'INSERT IGNORE INTO analytics_conversions (goal_id, session_id, path, occurred_at) VALUES (?, ?, ?, ?)',
        [goal.id, session.id, path, now],
      )) as { affectedRows: number };
      if (c.affectedRows) await this.db.query('UPDATE analytics_sessions SET conversions = conversions + 1 WHERE id = ?', [session.id]);
    }
  }

  private async activeGoals(): Promise<Goal[]> {
    if (this.goals && Date.now() - this.goals.at < 60_000) return this.goals.list;
    const list = (await this.db.query(
      'SELECT id, event_name eventName, label_contains labelContains FROM analytics_goals WHERE is_active = 1',
    )) as Goal[];
    this.goals = { list, at: Date.now() };
    return list;
  }

  /** Called when goals change, so new goals count straight away in this process. */
  forgetGoals() {
    this.goals = null;
  }

  /** Every night: delete raw visits older than the retention period, in small batches. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purge() {
    const { retentionMonths } = await this.settings.get();
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
    const tables: [string, string][] = [
      ['analytics_page_views', 'viewed_at'],
      ['analytics_events', 'occurred_at'],
      ['analytics_conversions', 'occurred_at'],
      ['analytics_sessions', 'last_seen_at'],
      ['analytics_visitors', 'last_seen_at'],
    ];
    let total = 0;
    for (const [table, column] of tables) {
      for (;;) {
        const r = (await this.db.query(`DELETE FROM ${table} WHERE ${column} < ? LIMIT 5000`, [cutoff])) as { affectedRows: number };
        total += r.affectedRows;
        if (r.affectedRows < 5000) break;
      }
    }
    if (total) this.log.log(`Deleted ${total} analytics rows older than ${retentionMonths} months.`);
  }
}

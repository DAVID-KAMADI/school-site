import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/*
 * Web analytics (Admin → Web analytics). Tables are written by the collection endpoint
 * (POST /api/v1/public/analytics/collect) and read by the reports. No IP addresses, user-agent strings,
 * query strings or form contents are stored: only categories (country, device, browser, channel, …).
 * Raw rows older than the retention period (Analytics settings) are deleted every night.
 */

const bigId = { type: 'bigint', unsigned: true } as const;

/**
 * A browser that accepted all cookies, so it carries a random ID (localStorage) and can be recognised
 * when it comes back. Visitors who chose "Essential only" never get a row here.
 */
@Entity('analytics_visitors')
export class AnalyticsVisitor {
  @PrimaryGeneratedColumn(bigId)
  id: string;

  /** SHA-256 of the browser's random ID (first 32 hex characters); the ID itself is never stored. */
  @Column({ type: 'char', length: 32, unique: true })
  visitorKey: string;

  @Column({ type: 'datetime' })
  firstSeenAt: Date;

  @Column({ type: 'datetime' })
  lastSeenAt: Date;

  @Column({ type: 'int', unsigned: true, default: 0 })
  sessions: number;
}

/** One visit: page views less than 30 minutes apart from the same browser. */
@Entity('analytics_sessions')
@Index('IDX_analytics_sessions_started', ['startedAt'])
@Index('IDX_analytics_sessions_visitor_hash', ['visitorHash', 'lastSeenAt'])
@Index('IDX_analytics_sessions_last_seen', ['lastSeenAt'])
export class AnalyticsSession {
  @PrimaryGeneratedColumn(bigId)
  id: string;

  /**
   * Counts unique visitors. For a recognised visitor: derived from their ID. Otherwise a hash of the address,
   * browser and a salt that changes every day and is then thrown away, so it cannot be followed across days.
   */
  @Column({ type: 'char', length: 16 })
  visitorHash: string;

  @Column({ ...bigId, nullable: true })
  visitorId: string | null;

  /** true/false for recognised visitors; null when unknown (essential cookies only). */
  @Column({ type: 'tinyint', nullable: true })
  isReturning: boolean | null;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime' })
  lastSeenAt: Date;

  @Column({ type: 'int', unsigned: true, default: 0 })
  pageViews: number;

  /** Clicks, downloads and other events (not page views). */
  @Column({ type: 'int', unsigned: true, default: 0 })
  events: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  engagedMs: number;

  /** Engaged: 10+ seconds on the site, 2+ pages, or an event. Sessions that aren't count as bounces. */
  @Column({ type: 'tinyint', default: 0 })
  isEngaged: boolean;

  @Column({ type: 'int', unsigned: true, default: 0 })
  conversions: number;

  @Column({ length: 300 })
  entryPath: string;

  @Column({ length: 300 })
  exitPath: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  referrerHost: string | null;

  @Column({ type: 'enum', enum: ['direct', 'organic', 'social', 'referral', 'email', 'paid', 'other'] })
  channel: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  utmSource: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  utmMedium: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  utmCampaign: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  utmTerm: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  utmContent: string | null;

  /** ISO 3166 code, e.g. "KE". Approximate, from the IP-location database; the address itself is not kept. */
  @Column({ type: 'char', length: 2, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  region: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  city: string | null;

  @Column({ type: 'enum', enum: ['desktop', 'mobile', 'tablet'] })
  device: string;

  @Column({ length: 30 })
  browser: string;

  @Column({ length: 30 })
  os: string;

  @Column({ type: 'enum', enum: ['small', 'medium', 'large', 'xlarge'], nullable: true })
  screen: string | null;
}

@Entity('analytics_page_views')
@Index('IDX_analytics_page_views_viewed', ['viewedAt'])
@Index('IDX_analytics_page_views_session', ['sessionId'])
@Index('IDX_analytics_page_views_path', ['path', 'viewedAt'])
export class AnalyticsPageView {
  @PrimaryGeneratedColumn(bigId)
  id: string;

  @Column(bigId)
  sessionId: string;

  @Column({ length: 300 })
  path: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ type: 'datetime' })
  viewedAt: Date;

  /** Time the page was visible, reported when the visitor leaves it. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  engagedMs: number;

  @Column({ type: 'tinyint', default: 0 })
  isEntry: boolean;
}

/** A click, download, form submission, sign-up or custom event. */
@Entity('analytics_events')
@Index('IDX_analytics_events_occurred', ['occurredAt'])
@Index('IDX_analytics_events_name', ['name', 'occurredAt'])
@Index('IDX_analytics_events_session', ['sessionId'])
export class AnalyticsEvent {
  @PrimaryGeneratedColumn(bigId)
  id: string;

  @Column(bigId)
  sessionId: string;

  /** Random ID made by the browser, so a retried request is not counted twice. */
  @Column({ type: 'char', length: 16, nullable: true, unique: true })
  clientId: string | null;

  /** e.g. "file_download", "contact_click", "application_submitted". */
  @Column({ length: 60 })
  name: string;

  @Column({ length: 40 })
  category: string;

  /** File name, link address or button text. Never form contents. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  label: string | null;

  @Column({ length: 300 })
  path: string;

  @Column({ type: 'datetime' })
  occurredAt: Date;
}

/** A conversion goal: an event (optionally only when its label contains some text). */
@Entity('analytics_goals')
export class AnalyticsGoal {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 80 })
  name: string;

  @Column({ length: 60 })
  eventName: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  labelContains: string | null;

  @Column({ type: 'tinyint', default: 1 })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}

/** A goal reached in a session: counted at most once per goal per session. */
@Entity('analytics_conversions')
@Index('UQ_analytics_conversions_goal_session', ['goalId', 'sessionId'], { unique: true })
@Index('IDX_analytics_conversions_occurred', ['occurredAt'])
export class AnalyticsConversion {
  @PrimaryGeneratedColumn(bigId)
  id: string;

  @Column({ type: 'int', unsigned: true })
  goalId: number;

  @Column(bigId)
  sessionId: string;

  @Column({ length: 300 })
  path: string;

  @Column({ type: 'datetime' })
  occurredAt: Date;
}

export const ANALYTICS_ENTITIES = [
  AnalyticsVisitor,
  AnalyticsSession,
  AnalyticsPageView,
  AnalyticsEvent,
  AnalyticsGoal,
  AnalyticsConversion,
];

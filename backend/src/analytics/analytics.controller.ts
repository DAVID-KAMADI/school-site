import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { isStaff, type AuthUser } from '../identity/auth-user.js';
import {
  CurrentUser,
  OptionalSession,
  Public,
  RequirePermissions,
  type AuthedRequest,
} from '../identity/decorators.js';
import { AnalyticsSettingsService, EVENT_NAME } from './analytics-settings.service.js';
import { AnalyticsGoal } from './analytics.entities.js';
import { CollectService } from './collect.service.js';
import { toCsv } from './csv.js';
import { GeoService } from './geo.service.js';
import { parseFilters, parseRange, ReportsService, type Interval } from './reports.service.js';

type Q = Record<string, unknown>;

/** The website's tracker: page views, time on page and events. Open to visitors, validated and rate limited. */
@Public()
@OptionalSession()
@Controller('public/analytics')
export class PublicAnalyticsController {
  constructor(
    private readonly collector: CollectService,
    private readonly settings: AnalyticsSettingsService,
  ) {}

  /** What the tracker needs to know: whether to run, and the custom events to watch for. */
  @Get('config')
  async config() {
    const s = await this.settings.get();
    return {
      enabled: s.enabled,
      respectDoNotTrack: s.respectDoNotTrack,
      customEvents: s.customEvents.filter((c) => c.type !== 'page'),
    };
  }

  /** Never fails for the visitor: anything wrong is dropped and the answer is still 200. */
  @Post('collect')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async collect(@Body() body: unknown, @Req() req: AuthedRequest) {
    const dnt = req.header('dnt') === '1' || req.header('sec-gpc') === '1';
    try {
      return await this.collector.collect(body, {
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? '',
        doNotTrack: dnt,
        isStaff: !!req.auth && isStaff(req.auth.user),
      });
    } catch {
      return { pv: [] };
    }
  }
}

/** Admin → Web analytics. Reports need analytics.view; settings and goals need analytics.manage. */
@Controller('admin/analytics')
@RequirePermissions('admin.access', 'analytics.view')
export class AdminAnalyticsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly settings: AnalyticsSettingsService,
    private readonly collector: CollectService,
    private readonly geo: GeoService,
    private readonly audit: AuditService,
    @InjectRepository(AnalyticsGoal) private readonly goals: Repository<AnalyticsGoal>,
  ) {}

  @Get('overview')
  overview(@Query() q: Q) {
    return this.reports.overview(parseRange(q), parseFilters(q));
  }

  @Get('trends')
  trends(@Query() q: Q) {
    const interval = (['hour', 'day', 'week', 'month'].includes(String(q.interval)) ? q.interval : 'day') as Interval;
    return this.reports.trends(parseRange(q), parseFilters(q), interval);
  }

  @Get('realtime')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  realtime() {
    return this.reports.realtime();
  }

  @Get('acquisition')
  acquisition(@Query() q: Q) {
    return this.reports.acquisition(parseRange(q), parseFilters(q));
  }

  @Get('geography')
  geography(@Query() q: Q) {
    return this.reports.geography(parseRange(q), parseFilters(q));
  }

  @Get('pages')
  pages(@Query() q: Q) {
    return this.reports.pages(parseRange(q), parseFilters(q), q);
  }

  @Get('devices')
  devices(@Query() q: Q) {
    return this.reports.devices(parseRange(q), parseFilters(q));
  }

  @Get('events')
  events(@Query() q: Q) {
    return this.reports.events(parseRange(q), parseFilters(q), q);
  }

  @Get('conversions')
  conversions(@Query() q: Q) {
    return this.reports.conversions(parseRange(q), parseFilters(q));
  }

  /** A report as a CSV file (opens in Excel). */
  @Get('export')
  async export(@Query() q: Q, @Res() res: Response, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const range = parseRange(q);
    const filters = parseFilters(q);
    const report = String(q.report);
    let rows: Record<string, unknown>[];
    switch (report) {
      case 'trend':
        rows = (await this.reports.trends(range, filters, 'day')).series;
        break;
      case 'channels':
        rows = (await this.reports.acquisition(range, filters)).channels;
        break;
      case 'referrers':
        rows = (await this.reports.acquisition(range, filters)).referrers;
        break;
      case 'campaigns':
        rows = (await this.reports.acquisition(range, filters)).campaigns;
        break;
      case 'countries':
        rows = (await this.reports.geography(range, filters)).countries;
        break;
      case 'cities':
        rows = (await this.reports.geography(range, filters)).cities;
        break;
      case 'pages':
        rows = await this.allPages(range, filters, q);
        break;
      case 'devices': {
        const d = await this.reports.devices(range, filters);
        rows = [
          ...d.devices.map((x) => ({ group: 'Device', ...x })),
          ...d.browsers.map((x) => ({ group: 'Browser', ...x })),
          ...d.systems.map((x) => ({ group: 'Operating system', ...x })),
          ...d.screens.map((x) => ({ group: 'Screen size', ...x })),
        ];
        break;
      }
      case 'events':
        rows = (await this.reports.events(range, filters, q)).events;
        break;
      case 'conversions':
        rows = (await this.reports.conversions(range, filters)).goals;
        break;
      default:
        throw new BadRequestException({ message: 'Unknown report.', code: 'VALIDATION' });
    }
    await this.audit.record({
      action: 'analytics.export', userId: user.id, entityType: 'analytics', entityId: report,
      details: { from: range.from, to: range.to, rows: rows.length }, ipAddress: req.ip,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="analytics-${report}-${range.from}-to-${range.to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(toCsv(rows));
  }

  /** Every page (up to 5,000) for the export, not only one page of the table. */
  private async allPages(range: ReturnType<typeof parseRange>, filters: ReturnType<typeof parseFilters>, q: Q) {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await this.reports.pages(range, filters, { ...q, page, size: 100 });
      out.push(...r.rows);
      if (out.length >= r.total || !r.rows.length) break;
    }
    return out;
  }

  // ---- Settings, goals, location database --------------------------------------------

  @Get('settings')
  async getSettings() {
    const [settings, goals, geo] = await Promise.all([
      this.settings.get(),
      this.goals.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.geo.status(),
    ]);
    return { settings, goals, geo };
  }

  @Put('settings')
  @RequirePermissions('analytics.manage')
  async saveSettings(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const saved = await this.settings.save(body, user.id);
    await this.log('analytics_settings.update', 'site_setting', 'analytics.settings', { enabled: saved.enabled, retentionMonths: saved.retentionMonths }, user, req);
    return saved;
  }

  @Post('goals')
  @RequirePermissions('analytics.manage')
  async createGoal(@Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const count = await this.goals.count();
    if (count >= 30) throw new BadRequestException({ message: 'Up to 30 goals.', code: 'VALIDATION' });
    const saved = await this.goals.save({ ...this.parseGoal(body), sortOrder: count });
    this.collector.forgetGoals();
    await this.log('analytics_goal.create', 'analytics_goal', saved.id, { name: saved.name }, user, req);
    return saved;
  }

  @Put('goals/:id')
  @RequirePermissions('analytics.manage')
  async updateGoal(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const goal = await this.goals.findOne({ where: { id } });
    if (!goal) throw new NotFoundException();
    const saved = await this.goals.save({ ...goal, ...this.parseGoal(body) });
    this.collector.forgetGoals();
    await this.log('analytics_goal.update', 'analytics_goal', id, { name: saved.name, isActive: saved.isActive }, user, req);
    return saved;
  }

  /** Removes the goal; conversions already recorded for it are removed too. */
  @Delete('goals/:id')
  @RequirePermissions('analytics.manage')
  async removeGoal(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const goal = await this.goals.findOne({ where: { id } });
    if (!goal) throw new NotFoundException();
    await this.goals.manager.transaction(async (m) => {
      await m.query('DELETE FROM analytics_conversions WHERE goal_id = ?', [id]);
      await m.delete(AnalyticsGoal, { id });
    });
    this.collector.forgetGoals();
    await this.log('analytics_goal.delete', 'analytics_goal', id, { name: goal.name }, user, req);
    return { ok: true };
  }

  /** Downloads the latest location database now (it also updates itself monthly). */
  @Post('geo/update')
  @RequirePermissions('analytics.manage')
  async updateGeo() {
    void this.geo.update().catch(() => undefined);
    return this.geo.status();
  }

  private parseGoal(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    const eventName = typeof b.eventName === 'string' ? b.eventName.trim().toLowerCase() : '';
    const label = typeof b.labelContains === 'string' ? b.labelContains.trim().slice(0, 120) : '';
    if (!name) throw new BadRequestException({ message: 'Give the goal a name.', code: 'VALIDATION' });
    if (!EVENT_NAME.test(eventName))
      throw new BadRequestException({ message: 'Choose the event that counts as this goal.', code: 'VALIDATION' });
    return { name, eventName, labelContains: label || null, isActive: b.isActive !== false };
  }

  private log(action: string, entityType: string, entityId: number | string, details: Record<string, unknown>, user: AuthUser, req: Request) {
    return this.audit.record({ action, userId: user.id, entityType, entityId, details, ipAddress: req.ip });
  }
}

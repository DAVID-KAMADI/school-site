import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { BackupService } from '../backup/backup.service.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { type AuthUser, isStaff } from '../identity/auth-user.js';

/** Kept in site_settings (group "maintenance": not on the Site settings page, not in the public site payload). */
export const MAINTENANCE_SETTING = 'maintenance.mode';

export interface MaintenanceMode {
  enabled: boolean;
  /** Heading on the maintenance page; empty uses the default. */
  title: string;
  /** Text under the heading; empty uses the default. */
  message: string;
  /** When the site is expected back (ISO time), for the countdown. Null: no time given. */
  endsAt: string | null;
  /** When it was switched on, so the progress ring knows how far along it is. */
  startedAt: string | null;
  /** Switch off by itself at endsAt. Otherwise the page says "almost done" until someone switches it off. */
  autoEnd: boolean;
}

const OFF: MaintenanceMode = { enabled: false, title: '', message: '', endsAt: null, startedAt: null, autoEnd: false };
/** Every page request checks the mode, so it is read from the database at most this often per process. */
const CACHE_MS = 3000;

/**
 * Maintenance mode: visitors see a "we'll be back soon" page (from the website server, with HTTP 503)
 * while staff who are signed in keep using the site and the admin. Also shown during a backup restore.
 */
@Injectable()
export class MaintenanceService {
  private cached: { at: number; mode: MaintenanceMode } | null = null;

  constructor(
    @InjectRepository(SiteSetting) private readonly settings: Repository<SiteSetting>,
    private readonly backups: BackupService,
    private readonly audit: AuditService,
  ) {}

  async mode(): Promise<MaintenanceMode> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.mode;
    const row = await this.settings.findOneBy({ key: MAINTENANCE_SETTING });
    const mode = { ...OFF, ...((row?.value as Partial<MaintenanceMode> | null) ?? {}) };
    this.cached = { at: Date.now(), mode };
    return mode;
  }

  /** On, and (with autoEnd) not yet past its end time. */
  static isOn(mode: MaintenanceMode, now = Date.now()) {
    return mode.enabled && !(mode.autoEnd && mode.endsAt && Date.parse(mode.endsAt) <= now);
  }

  /**
   * What the maintenance page and the website server need. `bypass`: this visitor is signed-in staff
   * (with two-step login done), who keep seeing the site so they can check their work.
   */
  async publicStatus(auth: { user: AuthUser; twoFactorVerified: boolean } | undefined) {
    const mode = await this.mode();
    const restoring = this.backups.restoring;
    const on = MaintenanceService.isOn(mode);
    const staff = !!auth?.twoFactorVerified && isStaff(auth.user);
    const restore = this.backups.maintenance();
    return {
      active: restoring || on,
      bypass: !restoring && staff,
      restoring,
      lastRestore: restore.lastRestore,
      title: restoring ? '' : mode.title,
      message: restoring ? '' : mode.message,
      endsAt: restoring ? null : mode.endsAt,
      startedAt: restoring ? null : mode.startedAt,
    };
  }

  async save(input: Partial<MaintenanceMode>, user: AuthUser, ip: string | null) {
    const current = await this.mode();
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && Number.isNaN(endsAt.getTime())) throw new BadRequestException('Choose a valid end time.');
    if (endsAt && endsAt.getTime() > Date.now() + 30 * 86_400_000)
      throw new BadRequestException('The end time must be within the next 30 days.');
    const enabled = input.enabled ?? current.enabled;
    if (enabled && input.autoEnd && !endsAt)
      throw new BadRequestException('Choose an end time to switch off automatically.');
    const mode: MaintenanceMode = {
      enabled,
      title: (input.title ?? current.title).trim().slice(0, 120),
      message: (input.message ?? current.message).trim().slice(0, 600),
      endsAt: endsAt ? endsAt.toISOString() : null,
      // Kept while it stays on, so the progress ring does not jump back when the time is extended.
      startedAt: enabled ? (current.enabled && current.startedAt ? current.startedAt : new Date().toISOString()) : null,
      autoEnd: !!input.autoEnd,
    };
    await this.settings.upsert(
      {
        key: MAINTENANCE_SETTING,
        groupName: 'maintenance',
        value: mode as unknown as object,
        description: 'Maintenance mode: visitors see the maintenance page',
        updatedBy: { id: user.id },
      },
      ['key'],
    );
    this.cached = null;
    if (mode.enabled !== current.enabled || mode.endsAt !== current.endsAt)
      await this.audit.record({
        action: mode.enabled ? (current.enabled ? 'maintenance.updated' : 'maintenance.on') : 'maintenance.off',
        userId: user.id,
        entityType: 'setting',
        entityId: MAINTENANCE_SETTING,
        details: { endsAt: mode.endsAt, autoEnd: mode.autoEnd },
        ipAddress: ip,
      });
    return { ...mode, active: MaintenanceService.isOn(mode) };
  }

  async adminView() {
    const mode = await this.mode();
    return { ...mode, active: MaintenanceService.isOn(mode), restoring: this.backups.restoring };
  }
}

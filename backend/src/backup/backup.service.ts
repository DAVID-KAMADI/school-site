import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Not } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { ContentCacheService } from '../cms/content-cache.service.js';
import { Session } from '../identity/entities/session.entity.js';
import {
  createBackup,
  deleteAllSessions,
  isBackupName,
  listBackups,
  rollback,
  type RollbackResult,
} from './backup-core.js';

export interface BackupJob {
  kind: 'backup' | 'restore';
  /** What it is doing now, e.g. "Restoring the database…". */
  step: string;
  startedAt: Date;
  by: string;
  /** For a restore: the backup being restored. */
  target: string | null;
}

export interface BackupOutcome {
  kind: 'backup' | 'restore';
  ok: boolean;
  finishedAt: Date;
  by: string;
  message: string;
  /** Restore: the backup that was restored, and the one holding the state it replaced. */
  restored?: string;
  safetyBackup?: string;
  /** Backup: the new backup's name. */
  backup?: string;
}

/** Time of the nightly automatic backup, in the server's local time (BACKUP_HOUR, default 2 = 02:00). */
const backupHour = () => {
  const h = Number(process.env.BACKUP_HOUR ?? 2);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 2;
};
const autoBackups = () => (process.env.BACKUP_AUTO ?? 'true').toLowerCase() !== 'false';

/**
 * Backups and rollback from the admin portal (super administrators only), plus the nightly backup.
 * One job at a time. While a restore runs the API answers "under maintenance" (MaintenanceMiddleware).
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private job: BackupJob | null = null;
  private last: BackupOutcome | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly cache: ContentCacheService,
  ) {}

  /** True while a restore replaces the database: every other request is turned away. */
  get restoring() {
    return this.job?.kind === 'restore';
  }

  status() {
    return {
      job: this.job,
      last: this.last,
      schedule: { automatic: autoBackups(), hour: backupHour() },
      offsiteCopy: !!process.env.BACKUP_COPY_DIR,
    };
  }

  async list() {
    return { backups: await listBackups(), ...this.status() };
  }

  /** Public (through GET /maintenance), for the "site is being restored" screen: no names, people or details. */
  maintenance() {
    return {
      restoring: this.restoring,
      lastRestore:
        this.last?.kind === 'restore' ? { ok: this.last.ok, finishedAt: this.last.finishedAt } : null,
    };
  }

  private begin(kind: BackupJob['kind'], by: string, target: string | null = null) {
    if (this.job)
      throw new ConflictException(
        this.job.kind === 'restore' ? 'A restore is already running.' : 'A backup is already running. Wait for it to finish.',
      );
    this.job = { kind, step: 'Starting…', startedAt: new Date(), by, target };
  }

  private step = (line: string) => {
    if (this.job) this.job.step = line;
    this.logger.log(line);
  };

  /** Starts a backup in the background; follow it with status(). */
  startBackup(by: { id: number | null; label: string }, note: string | null, reason: 'manual' | 'scheduled' = 'manual') {
    this.begin('backup', by.label);
    void (async () => {
      try {
        const { name } = await createBackup({ reason, createdBy: by.id ? by.label : null, note }, this.step);
        this.last = { kind: 'backup', ok: true, finishedAt: new Date(), by: by.label, backup: name, message: `Backup ${name} saved.` };
        await this.audit.record({
          action: 'backup.created',
          userId: by.id,
          entityType: 'backup',
          entityId: name,
          details: { reason, note },
        });
      } catch (err) {
        const message = `Backup failed: ${(err as Error).message}`;
        this.logger.error(message);
        this.last = { kind: 'backup', ok: false, finishedAt: new Date(), by: by.label, message };
      } finally {
        this.job = null;
      }
    })();
    return this.status();
  }

  /**
   * Rolls the site back to a backup, in the background. The caller has already confirmed the
   * person's identity. Everyone (including them) is signed out at the end.
   */
  async startRestore(
    name: string,
    by: { id: number; label: string },
    opts: { includeFiles: boolean; ip: string | null },
  ) {
    if (!isBackupName(name) || !(await listBackups()).some((b) => b.name === name))
      throw new NotFoundException('Backup not found.');
    this.begin('restore', by.label, name);
    // Recorded now so the request is in the "before-restore" backup, even though the restore replaces this log.
    await this.audit.record({
      action: 'backup.restore_started',
      userId: by.id,
      entityType: 'backup',
      entityId: name,
      details: { includeFiles: opts.includeFiles },
      ipAddress: opts.ip,
    });
    void (async () => {
      let result: RollbackResult | null = null;
      try {
        result = await rollback(name, { includeFiles: opts.includeFiles, createdBy: by.label }, this.step);
        this.step('Applying database updates made since the backup…');
        await this.dataSource.runMigrations({ transaction: 'each' });
        this.step('Signing everyone out…');
        await deleteAllSessions();
        this.cache.invalidate();
        // The restored database's log, so it shows the rollback; the person may not exist in it any more.
        await this.audit
          .record({
            action: 'backup.restored',
            userId: null,
            entityType: 'backup',
            entityId: name,
            details: { by: by.label, safetyBackup: result.safetyBackup, filesRestored: result.filesRestored },
            ipAddress: opts.ip,
          })
          .catch(() => undefined);
        this.last = {
          kind: 'restore',
          ok: true,
          finishedAt: new Date(),
          by: by.label,
          restored: name,
          safetyBackup: result.safetyBackup,
          message: `The site was restored to backup ${name}. Everyone has been signed out.`,
        };
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`Restore of ${name} failed: ${message}`);
        // Whatever state the database is in now, old sessions must not keep working.
        await deleteAllSessions().catch(() => undefined);
        this.cache.invalidate();
        this.last = {
          kind: 'restore',
          ok: false,
          finishedAt: new Date(),
          by: by.label,
          restored: name,
          safetyBackup: result?.safetyBackup,
          message,
        };
      } finally {
        this.job = null;
      }
    })();
    return this.status();
  }

  /** Emergency: signs out everyone except the person asking. */
  async signOutEveryone(userId: number, keepSessionId: string, ip: string | null) {
    const { affected } = await this.dataSource.getRepository(Session).delete({ id: Not(keepSessionId) });
    await this.audit.record({
      action: 'auth.everyone_signed_out',
      userId,
      details: { sessions: affected ?? 0 },
      ipAddress: ip,
    });
    return { signedOut: affected ?? 0 };
  }

  /** Nightly backup at BACKUP_HOUR. Skipped if one was made in the last hour (e.g. by another API process). */
  @Cron(CronExpression.EVERY_HOUR)
  async nightly(): Promise<void> {
    if (!autoBackups() || new Date().getHours() !== backupHour() || this.job) return;
    const newest = (await listBackups())[0];
    if (newest && Date.now() - Date.parse(newest.createdAt) < 60 * 60_000) return;
    try {
      this.startBackup({ id: null, label: 'Automatic nightly backup' }, null, 'scheduled');
    } catch (err) {
      this.logger.warn(`Nightly backup skipped: ${(err as Error).message}`);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity.js';

export interface AuditEntry {
  action: string;
  userId?: number | null;
  entityType?: string;
  entityId?: string | number;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  /** Records an action. Never throws: a failed audit write must not break the user's request. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          action: entry.action,
          user: entry.userId ? { id: entry.userId } : null,
          entityType: entry.entityType ?? null,
          entityId:
            entry.entityId === undefined ? null : String(entry.entityId),
          details: entry.details ?? null,
          ipAddress: entry.ipAddress ?? null,
        }),
      );
    } catch (err) {
      this.logger.error(`Audit write failed for ${entry.action}`, err as Error);
    }
  }
}

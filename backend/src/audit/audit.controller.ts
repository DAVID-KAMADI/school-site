import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Repository } from 'typeorm';
import { RequirePermissions } from '../identity/decorators.js';
import { AuditLog } from './audit-log.entity.js';

/** Groups shown as filter chips in the admin, matched by action prefix. */
const GROUPS = {
  security: [
    'auth.login_failed',
    'auth.login_blocked',
    'auth.account_locked',
    'auth.2fa_failed',
  ],
  auth: ['auth.'],
  content: ['page.', 'menu.', 'text.', 'settings.', 'redirect.'],
  media: ['media.'],
  users: ['user.'],
  admissions: ['application.'],
} as const;

class AuditQuery {
  @IsOptional() @IsIn(Object.keys(GROUPS)) group?: keyof typeof GROUPS;
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  /** Matches the person's name or email, the item id, or the IP address. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

@Controller('admin/audit')
@RequirePermissions('audit.view')
export class AuditController {
  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  @Get()
  async list(@Query() q: AuditQuery) {
    const pageSize = q.pageSize ?? 50;
    const page = q.page ?? 1;
    const qb = this.logs
      .createQueryBuilder('l')
      .leftJoin('l.user', 'u')
      .addSelect(['u.id', 'u.fullName', 'u.email']);

    if (q.group) {
      const patterns = GROUPS[q.group];
      qb.andWhere(
        `(${patterns.map((_, i) => `l.action LIKE :g${i}`).join(' OR ')})`,
        Object.fromEntries(
          patterns.map((p, i) => [`g${i}`, p.endsWith('.') ? `${p}%` : p]),
        ),
      );
    }
    if (q.action) qb.andWhere('l.action = :action', { action: q.action });
    if (q.search?.trim()) {
      const like = `%${q.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
      qb.andWhere(
        '(u.fullName LIKE :like OR u.email LIKE :like OR l.entityId = :exact OR l.ipAddress LIKE :like)',
        {
          like,
          exact: q.search.trim(),
        },
      );
    }
    if (q.from) qb.andWhere('l.createdAt >= :from', { from: new Date(q.from) });
    if (q.to) {
      // A bare date ("2026-10-01") includes the whole day.
      const to = new Date(q.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to.setUTCDate(to.getUTCDate() + 1);
      qb.andWhere('l.createdAt < :to', { to });
    }

    const [rows, total] = await qb
      .orderBy('l.createdAt', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: rows.map((l) => ({
        id: l.id,
        action: l.action,
        user: l.user
          ? { id: l.user.id, fullName: l.user.fullName, email: l.user.email }
          : null,
        entityType: l.entityType,
        entityId: l.entityId,
        details: l.details,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** The distinct actions recorded so far, for the filter list. */
  @Get('actions')
  async actions(): Promise<string[]> {
    const rows = await this.logs
      .createQueryBuilder('l')
      .select('DISTINCT l.action', 'action')
      .orderBy('action')
      .getRawMany<{ action: string }>();
    return rows.map((r) => r.action);
  }
}

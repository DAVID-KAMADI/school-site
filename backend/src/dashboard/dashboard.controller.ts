import { Controller, Get, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { canAnywhere, type AuthUser } from '../identity/auth-user.js';
import {
  CONTENT_PERMISSIONS,
  CurrentUser,
  RequirePermissions,
} from '../identity/decorators.js';

/** Days are counted in the institution's time zone, not the server's. */
const TIME_ZONE = process.env.SITE_TIME_ZONE || 'Africa/Nairobi';
const TREND_DAYS = 30;

// Made once: building a formatter costs about 0.25 ms, which per submitted application blocked the API for
// over a second when the trend covered a few thousand applications.
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dayKey = (d: Date) => dayFormat.format(d);

/**
 * Everything the admin home screen shows, in one request.
 * Each section is only included when the user may see it.
 */
@Controller('admin/dashboard')
@RequirePermissions('admin.access')
export class DashboardController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser) {
    const [applications, content, people, activity] = await Promise.all([
      canAnywhere(user, 'applications.view') ? this.applications() : null,
      CONTENT_PERMISSIONS.some((p) => canAnywhere(user, p))
        ? this.content()
        : null,
      canAnywhere(user, 'users.manage') ? this.people() : null,
      canAnywhere(user, 'audit.view') ? this.activity() : null,
    ]);
    return { applications, content, people, activity };
  }

  private async applications() {
    const q = <T>(sql: string, params: unknown[] = []) =>
      this.db.query(sql, params) as Promise<T>;
    const since = new Date(Date.now() - (TREND_DAYS + 1) * 86_400_000);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [byStatus, fee, week, submittedDates, recent, programmes, intakes] =
      await Promise.all([
        q<{ status: string; n: string }[]>(
          'SELECT status, COUNT(*) n FROM applications GROUP BY status',
        ),
        q<{ n: string }[]>(
          "SELECT COUNT(*) n FROM applications WHERE fee_status = 'claimed' AND status <> 'draft'",
        ),
        q<{ n: string }[]>(
          'SELECT COUNT(*) n FROM applications WHERE submitted_at >= ?',
          [weekAgo],
        ),
        q<{ submitted_at: Date }[]>(
          'SELECT submitted_at FROM applications WHERE submitted_at >= ?',
          [since],
        ),
        q<Record<string, unknown>[]>(
          `SELECT a.id, a.application_number applicationNumber, a.full_name fullName, a.status,
                  a.fee_status feeStatus, a.submitted_at submittedAt, p.name programme
             FROM applications a LEFT JOIN programmes p ON p.id = a.programme_id
            WHERE a.submitted_at IS NOT NULL
            ORDER BY a.submitted_at DESC LIMIT 6`,
        ),
        q<{ name: string; n: string }[]>(
          `SELECT p.name, COUNT(*) n FROM applications a JOIN programmes p ON p.id = a.programme_id
            WHERE a.status <> 'draft' GROUP BY p.id, p.name ORDER BY n DESC LIMIT 5`,
        ),
        q<{ id: number; name: string; closes_at: Date; n: string }[]>(
          `SELECT i.id, i.name, i.closes_at, COUNT(a.id) n
             FROM intakes i LEFT JOIN applications a ON a.intake_id = i.id AND a.status <> 'draft'
            WHERE i.is_active = 1 AND i.opens_at <= UTC_TIMESTAMP() AND i.closes_at > UTC_TIMESTAMP()
            GROUP BY i.id, i.name, i.closes_at ORDER BY i.closes_at`,
        ),
      ]);

    const counts = Object.fromEntries(
      byStatus.map((r) => [r.status, Number(r.n)]),
    );
    const perDay = new Map<string, number>();
    for (const r of submittedDates) {
      const k = dayKey(new Date(r.submitted_at));
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const trend = Array.from({ length: TREND_DAYS }, (_, i) => {
      const date = dayKey(
        new Date(Date.now() - (TREND_DAYS - 1 - i) * 86_400_000),
      );
      return { date, count: perDay.get(date) ?? 0 };
    });

    return {
      counts,
      feeToConfirm: Number(fee[0].n),
      submittedThisWeek: Number(week[0].n),
      trend,
      recent,
      programmes: programmes.map((p) => ({ name: p.name, count: Number(p.n) })),
      openIntakes: intakes.map((i) => ({
        id: i.id,
        name: i.name,
        closesAt: i.closes_at,
        applications: Number(i.n),
      })),
    };
  }

  private async content() {
    const [byStatus, review, recent, scheduled, media] = await Promise.all([
      this.db.query(
        'SELECT status, COUNT(*) n FROM pages WHERE deleted_at IS NULL GROUP BY status',
      ) as Promise<{ status: string; n: string }[]>,
      this.db.query(
        `SELECT p.id, p.title, p.updated_at updatedAt, u.full_name updatedBy
           FROM pages p LEFT JOIN users u ON u.id = p.updated_by_id
          WHERE p.deleted_at IS NULL AND p.status = 'in_review'
          ORDER BY p.updated_at DESC LIMIT 5`,
      ) as Promise<Record<string, unknown>[]>,
      this.db.query(
        `SELECT p.id, p.title, p.status, p.updated_at updatedAt, u.full_name updatedBy
           FROM pages p LEFT JOIN users u ON u.id = p.updated_by_id
          WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 5`,
      ) as Promise<Record<string, unknown>[]>,
      this.db.query(
        'SELECT COUNT(*) n FROM pages WHERE deleted_at IS NULL AND publish_at > UTC_TIMESTAMP()',
      ) as Promise<{ n: string }[]>,
      this.db.query(
        `SELECT SUM(mime_type LIKE 'image/%') images, SUM(mime_type NOT LIKE 'image/%') documents,
                COALESCE(SUM(size_bytes), 0) bytes
           FROM media WHERE deleted_at IS NULL`,
      ) as Promise<{ images: string; documents: string; bytes: string }[]>,
    ]);
    return {
      pages: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
      scheduled: Number(scheduled[0].n),
      inReview: review,
      recentlyEdited: recent,
      media: {
        images: Number(media[0].images ?? 0),
        documents: Number(media[0].documents ?? 0),
        bytes: Number(media[0].bytes),
      },
    };
  }

  private async people() {
    const [row] = (await this.db.query(
      `SELECT COUNT(*) staff,
              SUM(u.two_factor_enabled_at IS NULL) without2fa,
              SUM(u.locked_until > UTC_TIMESTAMP()) locked
         FROM users u
        WHERE u.status = 'active' AND EXISTS (
                SELECT 1 FROM user_roles ur
                  JOIN role_permissions rp ON rp.role_id = ur.role_id
                  JOIN permissions p ON p.id = rp.permission_id
                 WHERE ur.user_id = u.id AND p.key = 'admin.access')`,
    )) as { staff: string; without2fa: string; locked: string }[];
    return {
      staff: Number(row.staff),
      without2fa: Number(row.without2fa ?? 0),
      locked: Number(row.locked ?? 0),
    };
  }

  private async activity() {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [failed, recent] = await Promise.all([
      this.db.query(
        `SELECT COUNT(*) n FROM audit_logs
          WHERE created_at >= ? AND action IN ('auth.login_failed','auth.login_blocked','auth.account_locked','auth.2fa_failed')`,
        [dayAgo],
      ) as Promise<{ n: string }[]>,
      this.db.query(
        `SELECT l.id, l.action, l.entity_type entityType, l.entity_id entityId,
                l.created_at createdAt, u.full_name userName
           FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
          ORDER BY l.created_at DESC, l.id DESC LIMIT 8`,
      ) as Promise<Record<string, unknown>[]>,
    ]);
    return { failedSignIns24h: Number(failed[0].n), recent };
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}

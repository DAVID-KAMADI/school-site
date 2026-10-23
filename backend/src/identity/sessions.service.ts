import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import {
  DataSource,
  In,
  IsNull,
  LessThan,
  Not,
  type Repository,
} from 'typeorm';
import { authConfig } from '../config/auth.config.js';
import { isStaff, type AuthUser } from './auth-user.js';
import { Session } from './entities/session.entity.js';
import { User } from './entities/user.entity.js';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Only write last_seen_at when it is this stale, to avoid a database write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class SessionsService {
  private readonly config = authConfig();

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    private readonly dataSource: DataSource,
  ) {}

  /** Creates a session and returns the raw token for the cookie. */
  async create(
    user: AuthUser,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const session = this.sessions.create({
      id: hashToken(token),
      user: { id: user.id },
      twoFactorVerified: false,
      idleMinutes: isStaff(user)
        ? this.config.staffIdleMinutes
        : this.config.defaultIdleMinutes,
      lastSeenAt: now,
      expiresAt: new Date(
        now.getTime() + this.config.maxSessionHours * 3_600_000,
      ),
      ipAddress: meta.ip,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
    });
    await this.sessions.save(session);
    return { token, session };
  }

  /**
   * One device at a time for staff: called once a sign-in is complete (after the authenticator code,
   * when two-step login is on), so knowing the password alone cannot sign anyone out.
   * The other sessions are marked as replaced rather than deleted, so that device can be told why.
   * Locks the user row so two sign-ins finishing at once cannot both survive.
   */
  replaceOtherSessions(userId: number, keepSessionId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.findOneOrFail(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      const others = await manager.find(Session, {
        where: {
          user: { id: userId },
          id: Not(keepSessionId),
          replacedAt: IsNull(),
        },
      });
      if (others.length)
        await manager.update(
          Session,
          { id: In(others.map((o) => o.id)) },
          { replacedAt: new Date() },
        );
      return others.map((o) => ({
        ipAddress: o.ipAddress,
        userAgent: o.userAgent,
        signedInAt: o.createdAt,
      }));
    });
  }

  /**
   * Returns the live session for a cookie token, ending it if it has expired or been idle too long.
   * A session replaced by a newer staff sign-in comes back as { replaced: true }.
   */
  async validate(
    token: string,
  ): Promise<{ session: Session; userId: number } | { replaced: true } | null> {
    const id = hashToken(token);
    const session = await this.sessions.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!session) return null;
    if (session.replacedAt) return { replaced: true };

    const now = Date.now();
    const idleLimit =
      session.lastSeenAt.getTime() + session.idleMinutes * 60_000;
    if (now > session.expiresAt.getTime() || now > idleLimit) {
      await this.sessions.delete({ id });
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      session.lastSeenAt = new Date(now);
      await this.sessions.update({ id }, { lastSeenAt: session.lastSeenAt });
    }
    return { session, userId: session.user.id };
  }

  markTwoFactorVerified(sessionId: string) {
    return this.sessions.update({ id: sessionId }, { twoFactorVerified: true });
  }

  revoke(sessionId: string) {
    return this.sessions.delete({ id: sessionId });
  }

  /** Signs the user out everywhere, optionally keeping the current session. */
  revokeAllForUser(userId: number, exceptSessionId?: string) {
    return this.sessions.delete(
      exceptSessionId
        ? { user: { id: userId }, id: Not(exceptSessionId) }
        : { user: { id: userId } },
    );
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    await this.sessions.delete({ expiresAt: LessThan(new Date()) });
    // Replaced sessions only need to live long enough to tell that device why it was signed out.
    await this.sessions.delete({
      replacedAt: LessThan(new Date(Date.now() - 24 * 3_600_000)),
    });
  }
}

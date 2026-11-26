import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, LessThan, MoreThan, type Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { PasswordReset } from '../identity/entities/password-reset.entity.js';
import {
  AccountType,
  User,
  UserStatus,
} from '../identity/entities/user.entity.js';
import { SessionsService } from '../identity/sessions.service.js';
import { UsersService } from '../identity/users.service.js';
import { MessagingService } from '../messaging/messaging.service.js';

/** How long an emailed link works. */
export const RESET_LINK_MINUTES = 30;
/** Links one account can be sent per hour, so nobody can flood someone's inbox. */
const MAX_LINKS_PER_HOUR = 3;
/** One link at a time: asking again within this many seconds sends nothing new. */
const RESEND_GAP_SECONDS = 60;

export const INVALID_LINK =
  'This reset link is not valid any more. It may have expired, been used already, or a newer link was sent. Ask for a new one.';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Tokens are 32 random bytes in base64url: 43 characters. Anything else is not worth a database lookup. */
const looksLikeToken = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);

/** "d•••••i@gmail.com": enough for the person to recognise their account, not enough to read it off a shared screen. */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '•••';
  const shown = name.length <= 2 ? name[0] : `${name[0]}${'•'.repeat(Math.min(name.length - 2, 6))}${name[name.length - 1]}`;
  return `${shown}@${domain}`;
}

/**
 * "Forgot your password" for applicants and students (staff have their own sign-in links and two-step
 * login, and an administrator resets their passwords).
 *
 * - The link holds a random token. Only its hash is stored, together with the one account it was made for.
 *   Resetting never takes an email or account id from the browser: the account comes from the token alone,
 *   so a link can only ever change the password of the account it was sent to.
 * - A link works once, for 30 minutes. Asking again, signing in with a new password or an
 *   administrator reset makes older links stop working.
 * - The answer to "send me a link" is the same whether or not the email has an account, and the work
 *   happens after the reply, so neither the wording nor the timing tells anyone which emails are registered.
 * - After a reset every signed-in session of that account is ended.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordReset)
    private readonly resets: Repository<PasswordReset>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
  ) {}

  /** Starts the request in the background and returns at once (see the class comment). */
  request(email: string, ip: string | null): void {
    void this.sendLink(email, ip).catch((err: Error) =>
      this.logger.error('Password reset request failed', err),
    );
  }

  /** Exposed for tests; normal callers use request(). */
  async sendLink(email: string, ip: string | null): Promise<'sent' | 'skipped'> {
    const user = await this.users.findOneBy({
      email: email.trim().toLowerCase(),
    });
    if (!user || !this.mayReset(user)) {
      await this.audit.record({
        action: 'auth.password_reset_requested',
        details: { result: user ? 'not_allowed' : 'unknown_email' },
        ipAddress: ip,
      });
      return 'skipped';
    }

    const hourAgo = new Date(Date.now() - 3_600_000);
    const recent = await this.resets.find({
      where: { userId: user.id, createdAt: MoreThan(hourAgo) },
      order: { createdAt: 'DESC' },
    });
    const tooSoon =
      recent[0] &&
      Date.now() - recent[0].createdAt.getTime() < RESEND_GAP_SECONDS * 1000;
    if (tooSoon || recent.length >= MAX_LINKS_PER_HOUR) {
      await this.audit.record({
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
        details: { result: 'rate_limited' },
        ipAddress: ip,
      });
      return 'skipped';
    }

    // Only the newest link works.
    await this.resets.update(
      { userId: user.id, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { expiresAt: new Date() },
    );

    const token = randomBytes(32).toString('base64url');
    await this.resets.insert({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60_000),
      usedAt: null,
      requestedIp: ip?.slice(0, 45) ?? null,
    });

    const site = (process.env.FRONTEND_ORIGIN || 'http://localhost:4300').replace(/\/$/, '');
    // The token goes after # so it is never sent to a server, kept in web logs or passed on as a referrer.
    const link = `${site}/apply/reset-password#${token}`;
    const institution = await this.institutionName();
    const firstName = user.fullName.split(/\s+/)[0] || user.fullName;
    const body = (url: string) =>
      [
        `Hello ${firstName},`,
        `Someone (we hope you) asked to reset the password for your ${institution ? `${institution} ` : ''}application account (${user.email}).`,
        `To choose a new password, open this link within ${RESET_LINK_MINUTES} minutes:\n${url}`,
        'The link works once and only for this account. If you did not ask for it, ignore this email: your password stays the same.',
        institution ? `${institution} Admissions` : 'Admissions',
      ].join('\n\n');
    const result = await this.messaging.email(
      user.email,
      'Reset your password',
      body(link),
      {
        purpose: 'password_reset',
        sentById: null,
        recipientUserId: user.id,
        // Staff can read the message log; they must not be able to use someone's link.
        loggedText: body(`${site}/apply/reset-password#(link hidden)`),
      },
    );
    await this.audit.record({
      action: 'auth.password_reset_requested',
      entityType: 'user',
      entityId: user.id,
      details: { result: result.ok ? 'sent' : 'email_failed', error: result.error },
      ipAddress: ip,
    });
    return 'sent';
  }

  /** Whether a link still works, and for which account (masked), so the page can say whose password it changes. */
  async check(token: unknown): Promise<{ valid: true; email: string } | { valid: false }> {
    const found = await this.findUsable(token);
    return found ? { valid: true, email: maskEmail(found.user.email) } : { valid: false };
  }

  /** Sets the new password on the account the link was made for, then ends all its sessions. */
  async reset(token: unknown, password: string, ip: string | null): Promise<void> {
    const found = await this.findUsable(token);
    if (!found) throw new BadRequestException(INVALID_LINK);
    const { row, user } = found;

    // Check the password first, so a too-weak password does not use up the link.
    this.usersService.checkPasswordPolicy(password, user.email);

    // Claim the link: of two requests with the same link only one gets here.
    const claimed = await this.resets.update(
      { id: row.id, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { usedAt: new Date() },
    );
    if (!claimed.affected) throw new BadRequestException(INVALID_LINK);

    await this.usersService.setPassword(row.userId, password);
    await this.resets.update(
      { userId: row.userId, usedAt: IsNull() },
      { expiresAt: new Date() },
    );
    await this.sessions.revokeAllForUser(row.userId);
    await this.audit.record({
      action: 'auth.password_reset',
      userId: row.userId,
      entityType: 'user',
      entityId: row.userId,
      details: { via: 'emailed_link' },
      ipAddress: ip,
    });
  }

  private mayReset(user: User): boolean {
    return (
      user.status === UserStatus.Active &&
      user.accountType !== AccountType.Staff
    );
  }

  private async findUsable(token: unknown) {
    if (!looksLikeToken(token)) return null;
    const row = await this.resets.findOneBy({ tokenHash: hashToken(token) });
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    const user = await this.users.findOneBy({ id: row.userId });
    if (!user || !this.mayReset(user)) return null;
    // The password was changed after the link was sent (by the person or by admissions): the link is stale.
    // A second of slack because users.password_changed_at is stored to the whole second.
    if (user.passwordChangedAt && user.passwordChangedAt.getTime() > row.createdAt.getTime() + 1000)
      return null;
    return { row, user };
  }

  private async institutionName() {
    const row = await this.settings.findOneBy({ key: 'institution.name' });
    return typeof row?.value === 'string' ? row.value : '';
  }

  /** Old links are of no use to anyone; the audit log keeps the history. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOld(): Promise<void> {
    await this.resets.delete({
      createdAt: LessThan(new Date(Date.now() - 7 * 24 * 3_600_000)),
    });
  }
}

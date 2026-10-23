import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import type { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { authConfig } from '../config/auth.config.js';
import { isStaff, type AuthUser, type RequestAuth } from './auth-user.js';
import { User, UserStatus } from './entities/user.entity.js';
import { SessionsService } from './sessions.service.js';
import {
  SecretBox,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from './totp.js';
import { UsersService } from './users.service.js';

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  private readonly config = authConfig();
  private readonly box = new SecretBox(this.config.totpEncryptionKey);
  /** Verified against when the email is unknown, so response time does not reveal which emails exist. */
  private readonly dummyHash = argon2.hash('not-a-real-password', {
    type: argon2.argon2id,
  });

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly usersService: UsersService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta) {
    const user = await this.usersService.findByEmailWithSecrets(email);

    if (!user) {
      await argon2.verify(await this.dummyHash, password);
      await this.audit.record({
        action: 'auth.login_failed',
        details: { reason: 'unknown_email' },
        ipAddress: meta.ip,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audit.record({
        action: 'auth.login_blocked',
        userId: user.id,
        ipAddress: meta.ip,
      });
      throw new UnauthorizedException(
        `Too many failed attempts. Try again after ${this.config.lockoutMinutes} minutes or ask an administrator to unlock the account.`,
      );
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk || user.status !== UserStatus.Active) {
      await this.recordFailure(
        user,
        meta,
        passwordOk ? 'inactive' : 'bad_password',
      );
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    await this.users.update(user.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    const authUser = (await this.usersService.loadAuthUser(user.id))!;
    const { token, session } = await this.sessions.create(authUser, meta);
    await this.audit.record({
      action: 'auth.login',
      userId: user.id,
      ipAddress: meta.ip,
    });
    // Without two-step login the sign-in is already complete.
    if (!authUser.twoFactorEnabled)
      await this.endOtherStaffSessions(authUser, session.id, meta);

    return {
      token,
      sessionId: session.id,
      user: authUser,
      twoFactorRequired: authUser.twoFactorEnabled,
    };
  }

  private async recordFailure(user: User, meta: RequestMeta, reason: string) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= this.config.maxFailedLogins;
    await this.users.update(user.id, {
      failedLoginCount: lock ? 0 : failures,
      lockedUntil: lock
        ? new Date(Date.now() + this.config.lockoutMinutes * 60_000)
        : user.lockedUntil,
    });
    await this.audit.record({
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      userId: user.id,
      details: { reason, failures },
      ipAddress: meta.ip,
    });
  }

  /** Second login step: checks the authenticator code and upgrades the session. */
  async verifyTwoFactor(
    auth: RequestAuth,
    code: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.usersService.findByIdWithSecrets(auth.user.id);
    if (!user?.twoFactorSecret || !user.twoFactorEnabledAt)
      throw new BadRequestException('Two-step login is not enabled.');
    await this.checkCode(user, code, meta);
    await this.sessions.markTwoFactorVerified(auth.sessionId);
    await this.audit.record({
      action: 'auth.2fa_verified',
      userId: user.id,
      ipAddress: meta.ip,
    });
    await this.endOtherStaffSessions(auth.user, auth.sessionId, meta);
  }

  /**
   * Staff work on one device at a time: a completed sign-in signs out their other devices.
   * Applicants and students may stay signed in on several devices (phone and laptop).
   */
  private async endOtherStaffSessions(
    user: AuthUser,
    sessionId: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (!isStaff(user)) return;
    const replaced = await this.sessions.replaceOtherSessions(
      user.id,
      sessionId,
    );
    if (replaced.length)
      await this.audit.record({
        action: 'auth.session_replaced',
        userId: user.id,
        details: { signedOut: replaced },
        ipAddress: meta.ip,
      });
  }

  /** Starts 2FA setup: stores a new (not yet active) secret and returns what the authenticator app needs. */
  async beginTwoFactorSetup(
    user: AuthUser,
  ): Promise<{ secret: string; otpauthUri: string }> {
    if (user.twoFactorEnabled)
      throw new BadRequestException('Two-step login is already enabled.');
    const secret = generateTotpSecret();
    await this.users.update(user.id, {
      twoFactorSecret: this.box.encrypt(secret),
      twoFactorLastStep: null,
    });
    return {
      secret,
      otpauthUri: otpauthUri(secret, user.email, this.config.totpIssuer),
    };
  }

  /** Finishes 2FA setup once the user proves their app produces valid codes. */
  async enableTwoFactor(
    auth: RequestAuth,
    code: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.usersService.findByIdWithSecrets(auth.user.id);
    if (!user?.twoFactorSecret)
      throw new BadRequestException('Start two-step login setup first.');
    if (user.twoFactorEnabledAt)
      throw new BadRequestException('Two-step login is already enabled.');
    await this.checkCode(user, code, meta);
    await this.users.update(user.id, { twoFactorEnabledAt: new Date() });
    await this.sessions.markTwoFactorVerified(auth.sessionId);
    await this.sessions.revokeAllForUser(user.id, auth.sessionId);
    await this.audit.record({
      action: 'auth.2fa_enabled',
      userId: user.id,
      ipAddress: meta.ip,
    });
  }

  private async checkCode(
    user: User,
    code: string,
    meta: RequestMeta,
  ): Promise<void> {
    const step = verifyTotp(
      this.box.decrypt(user.twoFactorSecret!),
      code.trim(),
    );
    if (
      step === null ||
      (user.twoFactorLastStep !== null &&
        step <= Number(user.twoFactorLastStep))
    ) {
      await this.audit.record({
        action: 'auth.2fa_failed',
        userId: user.id,
        ipAddress: meta.ip,
      });
      throw new UnauthorizedException(
        'The code is incorrect or has already been used.',
      );
    }
    await this.users.update(user.id, { twoFactorLastStep: String(step) });
  }

  async changePassword(
    auth: RequestAuth,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.usersService.findByIdWithSecrets(auth.user.id);
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    await this.usersService.setPassword(user.id, newPassword);
    await this.sessions.revokeAllForUser(user.id, auth.sessionId);
    await this.audit.record({
      action: 'auth.password_changed',
      userId: user.id,
      ipAddress: meta.ip,
    });
  }
}

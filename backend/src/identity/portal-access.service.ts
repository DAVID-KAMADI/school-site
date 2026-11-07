import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, type Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { isStaff } from './auth-user.js';
import type { RequestMeta } from './auth.service.js';
import { PortalAccessKeyUser } from './entities/portal-access-key-user.entity.js';
import { PortalAccessKey, PortalKeyStatus } from './entities/portal-access-key.entity.js';
import { PortalAccessLog, type PortalAccessEvent } from './entities/portal-access-log.entity.js';
import {
  generatePortalKey,
  hashPortalKey,
  newNonce,
  normalisePortalKey,
  readPortalToken,
  signPortalToken,
} from './portal-access-crypto.js';
import { UsersService } from './users.service.js';

/** How long the sign-in page stays usable after opening a valid sign-in link. */
export const PASS_MINUTES = 15;
/** Wrong links allowed from one address within the window before it is blocked for the rest of it. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MINUTES = 15;

/** Reasons a link is refused. Visitors only ever see "page not found"; these go to the log and the API body. */
export const KEY_MESSAGES = {
  invalid: 'Invalid access key. Please contact your system administrator.',
  expired: 'This access key has expired.',
  revoked: 'This access key is no longer active.',
  blocked: `Too many attempts. Please wait ${FAILURE_WINDOW_MINUTES} minutes and try again.`,
} as const;

/** "exhausted": every place on the link is taken; the people it belongs to can still use it. */
export type PortalKeyState = 'active' | 'expired' | 'revoked' | 'exhausted';

/** The portal cookie as it arrived with the request. */
export interface PortalCookies {
  pass?: unknown;
}

export type LoginGate = { ok: true; keyId: string } | { ok: false };

const person = (u: { id: number; fullName: string } | null | undefined) =>
  u ? { id: u.id, fullName: u.fullName } : null;

@Injectable()
export class PortalAccessService {
  constructor(
    @InjectRepository(PortalAccessKey)
    private readonly keys: Repository<PortalAccessKey>,
    @InjectRepository(PortalAccessLog)
    private readonly logs: Repository<PortalAccessLog>,
    @InjectRepository(PortalAccessKeyUser)
    private readonly owners: Repository<PortalAccessKeyUser>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  static state(k: Pick<PortalAccessKey, 'status' | 'expiresAt' | 'currentUses' | 'maxUses'>, now = Date.now()): PortalKeyState {
    if (k.status === PortalKeyStatus.Revoked) return 'revoked';
    if (k.expiresAt.getTime() <= now) return 'expired';
    if (k.currentUses >= k.maxUses) return 'exhausted';
    return 'active';
  }

  private async views(rows: PortalAccessKey[]) {
    const owners = rows.length
      ? await this.owners.find({
          where: rows.map((k) => ({ keyId: k.id })),
          relations: { user: true },
          order: { createdAt: 'ASC' },
        })
      : [];
    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      keyHint: k.keyHint,
      status: PortalAccessService.state(k),
      createdAt: k.createdAt,
      createdBy: person(k.createdBy),
      expiresAt: k.expiresAt,
      maxUses: k.maxUses,
      currentUses: k.currentUses,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      revokedBy: person(k.revokedBy),
      /** The staff members this link belongs to, and since when. */
      people: owners
        .filter((o) => o.keyId === k.id)
        .map((o) => ({ ...person(o.user)!, since: o.createdAt })),
    }));
  }

  private async viewOne(id: string) {
    const k = await this.keys.findOneOrFail({ where: { id }, relations: { createdBy: true, revokedBy: true } });
    return (await this.views([k]))[0];
  }

  private async log(
    event: PortalAccessEvent,
    success: boolean,
    meta: RequestMeta,
    extra: { keyId?: string | null; userId?: number | null; details?: Record<string, unknown> } = {},
  ) {
    await this.logs.save(
      this.logs.create({
        event,
        success,
        key: extra.keyId ? { id: extra.keyId } : null,
        user: extra.userId ? { id: extra.userId } : null,
        ipAddress: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        details: extra.details ?? null,
      }),
    );
  }

  // ---- Administrator side -------------------------------------------------------------

  async list() {
    const rows = await this.keys.find({
      relations: { createdBy: true, revokedBy: true },
      order: { createdAt: 'DESC' },
    });
    return this.views(rows);
  }

  /**
   * Creates a sign-in link token and returns it in full. This is the only time it is available.
   * With `userId` the link is personal: only that staff member can sign in with it.
   */
  async create(
    input: { name: string; expiresAt: Date; maxUses: number; userId?: number | null },
    /** Null when created from the command line (npm run portal-key). */
    adminId: number | null,
    meta: RequestMeta,
  ) {
    if (input.userId) {
      const target = await this.users.loadAuthUser(input.userId);
      if (!target || !isStaff(target))
        throw new BadRequestException('Choose a staff member who can use the admin portal.');
    }
    const key = generatePortalKey();
    const normalised = normalisePortalKey(key)!;
    const saved = await this.keys.save(
      this.keys.create({
        name: input.name.trim(),
        keyHash: hashPortalKey(normalised),
        keyHint: normalised.slice(-5),
        createdBy: adminId ? { id: adminId } : null,
        expiresAt: input.expiresAt,
        maxUses: input.userId ? 1 : input.maxUses,
        currentUses: input.userId ? 1 : 0,
      }),
    );
    if (input.userId) await this.owners.insert({ keyId: saved.id, userId: input.userId });
    await this.log('key_created', true, meta, {
      keyId: saved.id,
      userId: adminId,
      details: {
        name: saved.name,
        expiresAt: input.expiresAt.toISOString(),
        maxUses: saved.maxUses,
        ...(input.userId ? { forUserId: input.userId } : {}),
        ...(adminId ? {} : { via: 'command_line' }),
      },
    });
    await this.audit.record({
      action: 'portal_key.created',
      userId: adminId,
      entityType: 'portal_access_key',
      entityId: saved.id,
      details: { name: saved.name, ...(input.userId ? { forUserId: input.userId } : {}) },
      ipAddress: meta.ip,
    });
    return { key, record: await this.viewOne(saved.id) };
  }

  /** Revokes at once: the link stops working, and so do sign-in pages already opened through it. */
  async revoke(id: string, adminId: number, meta: RequestMeta) {
    const k = await this.keys.findOne({ where: { id } });
    if (!k) throw new NotFoundException('Access key not found.');
    if (k.status !== PortalKeyStatus.Revoked) {
      await this.keys.update(id, {
        status: PortalKeyStatus.Revoked,
        revokedAt: new Date(),
        revokedBy: { id: adminId },
      });
      await this.log('key_revoked', true, meta, { keyId: id, userId: adminId });
      await this.audit.record({
        action: 'portal_key.revoked',
        userId: adminId,
        entityType: 'portal_access_key',
        entityId: id,
        details: { name: k.name },
        ipAddress: meta.ip,
      });
    }
    return this.viewOne(id);
  }

  /** Activity for one key, newest first, or for all keys (including wrong links) when id is omitted. */
  async activity(id?: string) {
    if (id && !(await this.keys.exists({ where: { id } })))
      throw new NotFoundException('Access key not found.');
    const rows = await this.logs.find({
      where: id ? { key: { id } } : {},
      relations: { user: true, key: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      success: r.success,
      at: r.createdAt,
      user: person(r.user),
      key: r.key ? { id: r.key.id, name: r.key.name, keyHint: r.key.keyHint } : null,
      ipAddress: r.ipAddress,
      reason: (r.details?.['reason'] as string | undefined) ?? null,
    }));
  }

  // ---- Visitor side -------------------------------------------------------------------

  /**
   * Checks the token from a sign-in link. On success returns a signed pass (for an HttpOnly cookie)
   * that lets this browser use the staff sign-in for PASS_MINUTES. Opening a link uses nothing up:
   * places on a link are taken by the people who sign in through it.
   */
  async verify(input: string, meta: RequestMeta, signedInUserId: number | null = null) {
    if (meta.ip) {
      const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000);
      const failures = await this.logs.count({
        where: { ipAddress: meta.ip, event: 'key_verified', success: false, createdAt: MoreThan(since) },
      });
      if (failures >= MAX_FAILURES) {
        await this.log('key_blocked', false, meta);
        throw new HttpException(
          { message: KEY_MESSAGES.blocked, code: 'ACCESS_KEY_BLOCKED' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const fail = async (
      reason: keyof typeof KEY_MESSAGES | 'link_belongs_to_others',
      keyId: string | null = null,
    ): Promise<never> => {
      await this.log('key_verified', false, meta, { keyId, userId: signedInUserId, details: { reason } });
      const message = reason === 'link_belongs_to_others' ? KEY_MESSAGES.invalid : KEY_MESSAGES[reason];
      throw new ForbiddenException({ message, code: 'ACCESS_KEY_REFUSED' });
    };

    const normalised = normalisePortalKey(input);
    if (!normalised) return fail('invalid');
    const k = await this.keys.findOne({ where: { keyHash: hashPortalKey(normalised) } });
    if (!k) return fail('invalid');
    if (k.status === PortalKeyStatus.Revoked) return fail('revoked', k.id);
    if (k.expiresAt.getTime() <= Date.now()) return fail('expired', k.id);
    // Someone already signed in may only open a link that is theirs (or still has a free place),
    // so another person's link never leads anywhere, even from a signed-in browser.
    if (
      signedInUserId &&
      k.currentUses >= k.maxUses &&
      !(await this.owners.exists({ where: { keyId: k.id, userId: signedInUserId } }))
    )
      return fail('link_belongs_to_others', k.id);

    const expiresAt = new Date(Date.now() + PASS_MINUTES * 60_000);
    await this.log('key_verified', true, meta, { keyId: k.id });
    return {
      token: signPortalToken({ t: 'pass', k: k.id, e: expiresAt.getTime(), n: newNonce() }),
      expiresAt,
    };
  }

  /** Whether this browser came through a valid sign-in link in the last few minutes. */
  async status(cookies: PortalCookies): Promise<{ granted: boolean; expiresAt: Date | null }> {
    const t = readPortalToken(cookies.pass);
    if (t && (await this.usableKey(t.k))) return { granted: true, expiresAt: new Date(t.e) };
    return { granted: false, expiresAt: null };
  }

  private async usableKey(keyId: string) {
    const k = await this.keys.findOne({
      where: { id: keyId },
      select: { id: true, status: true, expiresAt: true, maxUses: true, currentUses: true },
    });
    return k && k.status === PortalKeyStatus.Active && k.expiresAt.getTime() > Date.now() ? k : null;
  }

  /**
   * Run at staff sign-in, before the password is checked: the browser needs a current pass from a
   * link that is still valid, and the link must belong to this person or still have a free place.
   */
  async checkForLogin(userId: number, cookies: PortalCookies, meta: RequestMeta): Promise<LoginGate> {
    const pass = readPortalToken(cookies.pass);
    const k = pass ? await this.usableKey(pass.k) : null;
    let reason = 'no_access_pass';
    if (k) {
      if (await this.owners.exists({ where: { keyId: k.id, userId } })) return { ok: true, keyId: k.id };
      if (k.currentUses < k.maxUses) return { ok: true, keyId: k.id };
      reason = 'link_belongs_to_others';
    }
    await this.log('staff_login_denied', false, meta, { keyId: k?.id ?? null, userId, details: { reason } });
    return { ok: false };
  }

  /**
   * After the password is confirmed and before a session is created: the link becomes this person's
   * if it is not already. One statement, so two people cannot both take a link's last place.
   */
  async claim(gate: Extract<LoginGate, { ok: true }>, userId: number, meta: RequestMeta): Promise<boolean> {
    const already = await this.owners.exists({ where: { keyId: gate.keyId, userId } });
    if (!already) {
      const result = await this.keys
        .createQueryBuilder()
        .update()
        .set({ currentUses: () => 'current_uses + 1' })
        .where('id = :id AND current_uses < max_uses', { id: gate.keyId })
        .execute();
      if (!result.affected) {
        await this.log('staff_login_denied', false, meta, { keyId: gate.keyId, userId, details: { reason: 'link_belongs_to_others' } });
        return false;
      }
      await this.owners.insert({ keyId: gate.keyId, userId });
    }
    await this.keys.update(gate.keyId, { lastUsedAt: new Date() });
    await this.log('staff_login', true, meta, { keyId: gate.keyId, userId, details: already ? undefined : { firstUse: true } });
    return true;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { DataSource, IsNull, Like, type Repository } from 'typeorm';
import { withDeadlockRetry } from '../database/retry.js';
import type { AuthUser } from './auth-user.js';
import { Permission } from './entities/permission.entity.js';
import { Role, RoleAudience } from './entities/role.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { AccountType, User, UserStatus } from './entities/user.entity.js';
import { weakPasswordReason } from './weak-passwords.js';

export const MIN_PASSWORD_LENGTH = 12;

/** Holds every staff permission, including ones added later. Cannot be edited. */
export const SUPER_ADMIN_ROLE = 'super_admin';

/** Permissions that belong to the applicant and student portals, never to staff. */
export const PORTAL_MODULE = 'Applicant portal';

export interface RoleGrant {
  roleKey: string;
  scopePageId?: number | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,
    private readonly dataSource: DataSource,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  checkPasswordPolicy(password: string, email: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
    if (password.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
      throw new BadRequestException(
        'Password must not contain your email name.',
      );
    }
    const weak = weakPasswordReason(password);
    if (weak) throw new BadRequestException(weak);
  }

  generatePassword(): string {
    return randomBytes(15).toString('base64url');
  }

  /** Loads everything guards need about a user: roles and global vs section-limited permissions. */
  async loadAuthUser(userId: number): Promise<AuthUser | null> {
    const user = await this.users.findOne({
      where: { id: userId, status: UserStatus.Active },
    });
    if (!user) return null;

    const rows: {
      role_key: string;
      permission_key: string | null;
      scope_page_id: number | null;
    }[] = await this.dataSource.query(
      `SELECT r.\`key\` AS role_key, p.\`key\` AS permission_key, ur.scope_page_id
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = ?`,
      [userId],
    );

    const roles = new Set<string>();
    const permissions = new Set<string>();
    // The super administrator holds every staff permission, so new permissions never need granting to it.
    if (rows.some((r) => r.role_key === SUPER_ADMIN_ROLE)) {
      const all = await this.permissionRepo.find({
        select: { key: true, module: true },
      });
      for (const p of all)
        if (p.module !== PORTAL_MODULE) permissions.add(p.key);
    }
    const scoped = new Map<string, { permission: string; pageId: number }>();
    for (const row of rows) {
      roles.add(row.role_key);
      if (!row.permission_key) continue;
      if (row.scope_page_id === null) permissions.add(row.permission_key);
      else
        scoped.set(`${row.permission_key}:${row.scope_page_id}`, {
          permission: row.permission_key,
          pageId: Number(row.scope_page_id),
        });
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: [...roles],
      permissions: [...permissions],
      scopedPermissions: [...scoped.values()].filter(
        (p) => !permissions.has(p.permission),
      ),
      twoFactorEnabled: user.twoFactorEnabledAt !== null,
    };
  }

  findByEmailWithSecrets(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect(['u.passwordHash', 'u.twoFactorSecret', 'u.twoFactorLastStep'])
      .where('u.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findByIdWithSecrets(id: number): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect(['u.passwordHash', 'u.twoFactorSecret', 'u.twoFactorLastStep'])
      .where('u.id = :id', { id })
      .getOne();
  }

  /** Staff accounts only: applicants and students are managed separately. */
  list() {
    return this.users.find({
      where: { accountType: AccountType.Staff },
      relations: { roles: { scopePage: true } },
      order: { fullName: 'ASC' },
    });
  }

  /** Applicant (or student) accounts, newest first, optionally filtered by name or email. */
  listPortalAccounts(
    accountType: AccountType.Applicant | AccountType.Student,
    search: string,
    page: number,
    pageSize: number,
  ) {
    const term = search.trim();
    const base = { accountType };
    return this.users.findAndCount({
      where: term
        ? [
            { ...base, fullName: Like(`%${term}%`) },
            { ...base, email: Like(`%${term}%`) },
          ]
        : base,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  /** The account, if it is of the given type (so applicant tools cannot touch staff accounts). */
  async findOfType(id: number, accountType: AccountType): Promise<User> {
    const user = await this.users.findOneBy({ id, accountType });
    if (!user) throw new NotFoundException('Account not found.');
    return user;
  }

  /** Roles for one kind of account (staff roles by default). */
  listRoles(audience: RoleAudience = RoleAudience.Staff) {
    return this.roles.find({
      where: { audience },
      relations: { permissions: true },
      order: { id: 'ASC' },
    });
  }

  async create(input: {
    email: string;
    fullName: string;
    phone?: string | null;
    password: string;
    accountType?: AccountType;
  }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    this.checkPasswordPolicy(input.password, email);
    if (await this.users.exists({ where: { email } }))
      throw new ConflictException('A user with this email already exists.');
    const user = this.users.create({
      email,
      fullName: input.fullName.trim(),
      phone: input.phone ?? null,
      passwordHash: await this.hashPassword(input.password),
      passwordChangedAt: new Date(),
      status: UserStatus.Active,
      accountType: input.accountType ?? AccountType.Staff,
    });
    try {
      return await this.users.save(user);
    } catch (err) {
      // Two sign-ups with the same email at the same moment (a double-click): the unique index lets
      // one through; the other is told the account exists instead of getting a server error.
      const code =
        (err as { driverError?: { code?: string }; code?: string }).driverError
          ?.code ?? (err as { code?: string }).code;
      if (code === 'ER_DUP_ENTRY')
        throw new ConflictException('A user with this email already exists.');
      throw err;
    }
  }

  async update(
    id: number,
    changes: Partial<Pick<User, 'fullName' | 'phone' | 'status'>>,
  ): Promise<User> {
    const user = await this.users.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found.');
    if (changes.status && changes.status !== UserStatus.Active)
      await this.assertNotLastSuperAdmin(id);
    Object.assign(user, changes);
    return this.users.save(user);
  }

  /** Records that the user agreed to the Terms of Service and Privacy Policy (which version, and when). */
  async recordTermsAcceptance(userId: number, version: string): Promise<void> {
    await this.users.update(userId, {
      termsAcceptedAt: new Date(),
      termsVersion: version.slice(0, 20),
    });
  }

  async setPassword(userId: number, password: string): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found.');
    this.checkPasswordPolicy(password, user.email);
    await this.users.update(userId, {
      passwordHash: await this.hashPassword(password),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    });
  }

  /** Replaces all of a user's role grants. Staff get staff roles only; applicants applicant roles only. */
  async setRoles(userId: number, grants: RoleGrant[]): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found.');
    const roleRows = await this.roles.find();
    const byKey = new Map(roleRows.map((r) => [r.key, r]));
    for (const g of grants) {
      const role = byKey.get(g.roleKey);
      if (!role) throw new BadRequestException(`Unknown role: ${g.roleKey}`);
      if ((role.audience as string) !== (user.accountType as string))
        throw new BadRequestException(
          role.audience === RoleAudience.Staff
            ? 'Applicant and student accounts cannot be given staff roles. Create a separate staff account.'
            : `The ${role.name} role is for ${role.audience} accounts, not staff.`,
        );
    }
    if (!grants.some((g) => g.roleKey === 'super_admin' && !g.scopePageId)) {
      await this.assertNotLastSuperAdmin(userId);
    }

    const unique = new Map(
      grants.map((g) => [`${g.roleKey}:${g.scopePageId ?? ''}`, g]),
    );
    await withDeadlockRetry(() =>
      this.dataSource.transaction(async (em) => {
        await em.delete(UserRole, { user: { id: userId } });
        for (const g of unique.values()) {
          await em.insert(UserRole, {
            user: { id: userId },
            role: byKey.get(g.roleKey)!,
            scopePage: g.scopePageId ? { id: g.scopePageId } : null,
          });
        }
      }),
    );
  }

  async resetTwoFactor(userId: number): Promise<void> {
    await this.users.update(userId, {
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      twoFactorLastStep: null,
    });
  }

  private async assertNotLastSuperAdmin(userId: number): Promise<void> {
    const admins = await this.userRoles.find({
      where: {
        role: { key: 'super_admin' },
        scopePage: IsNull(),
        user: { status: UserStatus.Active },
      },
      relations: { user: true, role: true },
    });
    if (admins.length === 1 && admins[0].user.id === userId) {
      throw new BadRequestException(
        'This is the last active super administrator and cannot be removed or disabled.',
      );
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, type Repository } from 'typeorm';
import { Permission } from './entities/permission.entity.js';
import { Role, RoleAudience } from './entities/role.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { AccountType, UserStatus } from './entities/user.entity.js';
import { PORTAL_MODULE, SUPER_ADMIN_ROLE } from './users.service.js';

/** Everyone who works in the admin portal needs this to sign in to it. */
const ADMIN_ACCESS = 'admin.access';

/**
 * Access control: which staff role may do what.
 *
 * Permissions are checked against the database on every request, so a change here applies at
 * once, without anyone signing in again. The Super administrator role always holds every staff
 * permission and cannot be edited, so nobody can lock the institution out of its own system.
 * Applicant and student roles are fixed and not shown here.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoles: Repository<UserRole>,
  ) {}

  /** Staff permissions grouped by module, every staff role with what it holds, and how many people have it. */
  async matrix() {
    const [perms, roles, counts] = await Promise.all([
      this.staffPermissions(),
      this.roles.find({
        where: { audience: RoleAudience.Staff },
        relations: { permissions: true },
        order: { id: 'ASC' },
      }),
      this.userRoles
        .createQueryBuilder('ur')
        .innerJoin('ur.user', 'u')
        .select('ur.role_id', 'roleId')
        .addSelect('COUNT(DISTINCT u.id)', 'people')
        .where('u.status = :active', { active: UserStatus.Active })
        .groupBy('ur.role_id')
        .getRawMany<{ roleId: number; people: string }>(),
    ]);
    const people = new Map(
      counts.map((c) => [Number(c.roleId), Number(c.people)]),
    );
    const all = perms.map((p) => p.key);
    return {
      permissions: perms.map((p) => ({
        key: p.key,
        description: p.description,
        module: p.module,
      })),
      roles: roles.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        locked: r.isLocked,
        people: people.get(r.id) ?? 0,
        permissions:
          r.key === SUPER_ADMIN_ROLE
            ? all
            : r.permissions.map((p) => p.key).filter((k) => all.includes(k)),
      })),
    };
  }

  /**
   * Sets exactly which permissions a role holds. Returns what was added and removed, for the audit log.
   * Any role with permissions can open the admin portal, so admin.access is added automatically.
   */
  async setRolePermissions(roleKey: string, keys: string[]) {
    const role = await this.editableRole(roleKey);
    const wanted = new Set(keys);
    if (wanted.size) wanted.add(ADMIN_ACCESS);
    const perms = wanted.size
      ? await this.permissions.find({
          where: { key: In([...wanted]), module: Not(PORTAL_MODULE) },
        })
      : [];
    const unknown = [...wanted].filter((k) => !perms.some((p) => p.key === k));
    if (unknown.length)
      throw new BadRequestException(
        `Unknown permission: ${unknown.join(', ')}`,
      );

    const before = new Set(role.permissions.map((p) => p.key));
    role.permissions = perms;
    await this.roles.save(role);
    return {
      role: role.name,
      added: [...wanted].filter((k) => !before.has(k)),
      removed: [...before].filter((k) => !wanted.has(k)),
    };
  }

  /** A new staff role, optionally starting with another role's permissions. */
  async createRole(input: {
    name: string;
    description?: string | null;
    copyFrom?: string | null;
  }) {
    const name = input.name.trim();
    if (name.length < 2) throw new BadRequestException('Give the role a name.');
    const base = this.slug(name);
    let key = base;
    for (let i = 2; await this.roles.exists({ where: { key } }); i++)
      key = `${base}_${i}`;
    if (
      await this.roles.exists({ where: { name, audience: RoleAudience.Staff } })
    )
      throw new ConflictException(`There is already a role called ${name}.`);

    let permissions: Permission[] = [];
    if (input.copyFrom) {
      if (input.copyFrom === SUPER_ADMIN_ROLE) {
        permissions = await this.staffPermissions();
      } else {
        const source = await this.roles.findOne({
          where: { key: input.copyFrom, audience: RoleAudience.Staff },
          relations: { permissions: true },
        });
        if (!source)
          throw new NotFoundException('The role to copy from was not found.');
        permissions = source.permissions;
      }
    }
    const role = await this.roles.save(
      this.roles.create({
        key,
        name,
        description: input.description?.trim() || null,
        audience: RoleAudience.Staff,
        isLocked: false,
        permissions,
      }),
    );
    return { key: role.key, name: role.name };
  }

  async updateRole(
    roleKey: string,
    input: { name?: string; description?: string | null },
  ) {
    const role = await this.editableRole(roleKey);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2)
        throw new BadRequestException('Give the role a name.');
      const clash = await this.roles.findOne({
        where: { name, audience: RoleAudience.Staff },
      });
      if (clash && clash.id !== role.id)
        throw new ConflictException(`There is already a role called ${name}.`);
      role.name = name;
    }
    if (input.description !== undefined)
      role.description = input.description?.trim() || null;
    await this.roles.save(role);
    return { key: role.key, name: role.name };
  }

  /** Only a role nobody holds can be deleted, so nobody loses access by surprise. */
  async deleteRole(roleKey: string) {
    const role = await this.editableRole(roleKey);
    const holders = await this.userRoles.count({
      where: { role: { id: role.id } },
    });
    if (holders)
      throw new BadRequestException(
        `${holders} ${holders === 1 ? 'person has' : 'people have'} this role. Give them another role first.`,
      );
    await this.roles.remove(role);
    return { name: role.name };
  }

  /** Access review: every staff account, its roles and the modules it can reach. */
  async review() {
    const [perms, grants] = await Promise.all([
      this.staffPermissions(),
      this.userRoles.find({
        where: { user: { accountType: AccountType.Staff } },
        relations: { user: true, role: { permissions: true }, scopePage: true },
      }),
    ]);
    // "Admissions · Intakes" counts as Admissions in the review.
    const moduleOf = new Map(
      perms.map((p) => [p.key, p.module.split(' · ')[0]]),
    );
    const people = new Map<
      number,
      {
        id: number;
        fullName: string;
        email: string;
        status: string;
        lastLoginAt: Date | null;
        roles: { name: string; section: string | null }[];
        modules: Set<string>;
      }
    >();
    for (const g of grants) {
      const u = g.user;
      const row =
        people.get(u.id) ??
        people
          .set(u.id, {
            id: u.id,
            fullName: u.fullName,
            email: u.email,
            status: u.status,
            lastLoginAt: u.lastLoginAt,
            roles: [],
            modules: new Set(),
          })
          .get(u.id)!;
      row.roles.push({
        name: g.role.name,
        section: g.scopePage?.title ?? null,
      });
      const keys =
        g.role.key === SUPER_ADMIN_ROLE
          ? perms.map((p) => p.key)
          : g.role.permissions.map((p) => p.key);
      for (const k of keys) {
        const m = moduleOf.get(k);
        if (m && k !== ADMIN_ACCESS) row.modules.add(m);
      }
    }
    const order = [...new Set(perms.map((p) => p.module.split(' · ')[0]))];
    return [...people.values()]
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((p) => ({ ...p, modules: order.filter((m) => p.modules.has(m)) }));
  }

  private staffPermissions() {
    return this.permissions.find({
      where: { module: Not(PORTAL_MODULE) },
      order: { sortOrder: 'ASC', key: 'ASC' },
    });
  }

  private async editableRole(roleKey: string): Promise<Role> {
    const role = await this.roles.findOne({
      where: { key: roleKey, audience: RoleAudience.Staff },
      relations: { permissions: true },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.isLocked)
      throw new BadRequestException(
        `The ${role.name} role is fixed and cannot be changed.`,
      );
    return role;
  }

  private slug(name: string) {
    return (
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'role'
    );
  }
}

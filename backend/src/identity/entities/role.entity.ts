import {
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Permission } from './permission.entity.js';

/** Who a role is for: staff use the admin portal; applicants and students their own portals. */
export enum RoleAudience {
  Staff = 'staff',
  Applicant = 'applicant',
  Student = 'student',
}

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** Stable machine key, e.g. "content_editor". */
  @Column({ length: 50, unique: true })
  key: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: RoleAudience, default: RoleAudience.Staff })
  audience: RoleAudience;

  /** Locked roles keep fixed permissions (Super administrator: everything; Applicant: the applicant portal). */
  @Column({ default: false })
  isLocked: boolean;

  @ManyToMany(() => Permission)
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id' },
    inverseJoinColumn: { name: 'permission_id' },
  })
  permissions: Relation<Permission[]>;
}

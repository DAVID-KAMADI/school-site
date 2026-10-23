import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { UserRole } from './user-role.entity.js';

export enum UserStatus {
  Pending = 'pending',
  Active = 'active',
  Disabled = 'disabled',
}

/** Staff use the admin portal; applicants and students only their own portals. Kept apart in the admin. */
export enum AccountType {
  Staff = 'staff',
  Applicant = 'applicant',
  Student = 'student',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 191, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ length: 150 })
  fullName: string;

  @Column({ length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Pending })
  status: UserStatus;

  @Index('IDX_users_account_type')
  @Column({ type: 'enum', enum: AccountType, default: AccountType.Staff })
  accountType: AccountType;

  /** Encrypted TOTP secret. Set during setup; only active once twoFactorEnabledAt is set. */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  twoFactorSecret: string | null;

  @Column({ type: 'datetime', nullable: true })
  twoFactorEnabledAt: Date | null;

  /** Last accepted TOTP time step, so a code cannot be reused. */
  @Column({ type: 'bigint', nullable: true, select: false })
  twoFactorLastStep: string | null;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  failedLoginCount: number;

  @Column({ type: 'datetime', nullable: true })
  lockedUntil: Date | null;

  @Column({ type: 'datetime', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  /** When the person agreed to the Terms of Service and Privacy Policy (applicants, at registration). */
  @Column({ type: 'datetime', nullable: true })
  termsAcceptedAt: Date | null;

  /** Which version they agreed to (site setting legal.terms_version at the time). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  termsVersion: string | null;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  roles: Relation<UserRole[]>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

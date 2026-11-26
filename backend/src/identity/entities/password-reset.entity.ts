import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from './user.entity.js';

/**
 * A "forgot your password" link. The emailed link holds a random token; only its SHA-256 hash is
 * stored, so the table cannot be used to reset anyone's password. Each row belongs to exactly one
 * account, and the reset changes that account and no other.
 */
@Entity('password_resets')
@Index('IDX_password_resets_user_created', ['userId', 'createdAt'])
export class PasswordReset {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** SHA-256 hex of the token in the link. */
  @Index('UQ_password_resets_token', { unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash: string;

  @Column({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  /** Set when the link is used; a link works once. */
  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  /** Where the request came from (shown in the audit log, not to the account holder). */
  @Column({ type: 'varchar', length: 45, nullable: true })
  requestedIp: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;
}

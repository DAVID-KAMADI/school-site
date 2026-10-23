import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from 'typeorm';
import { User } from './user.entity.js';

/**
 * A signed-in browser session. The cookie holds a random token; only its SHA-256 hash is stored,
 * so a database leak does not reveal usable session tokens.
 */
@Entity('sessions')
export class Session {
  /** SHA-256 hex of the session token. */
  @PrimaryColumn({ type: 'char', length: 64 })
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  user: Relation<User>;

  /** False until the user enters a valid authenticator code (only relevant when 2FA is enabled). */
  @Column({ default: false })
  twoFactorVerified: boolean;

  /** Minutes of inactivity before the session ends (shorter for staff). */
  @Column({ type: 'smallint', unsigned: true })
  idleMinutes: number;

  @Column({ type: 'datetime' })
  lastSeenAt: Date;

  /** Absolute end of the session regardless of activity. */
  @Column({ type: 'datetime' })
  expiresAt: Date;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  /** Set when the same staff member finished signing in elsewhere; the session no longer works. */
  @Column({ type: 'datetime', nullable: true })
  replacedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}

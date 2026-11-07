import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from './user.entity.js';

/** Stored status. "Expired" and "exhausted" are worked out from the dates and counts when read. */
export enum PortalKeyStatus {
  Active = 'active',
  Revoked = 'revoked',
}

/**
 * An invitation key that lets a browser reach the staff sign-in page (it never signs anyone in).
 * Only an HMAC-SHA-256 of the key is stored; the key itself is shown once, when generated.
 */
@Entity('admin_portal_access_keys')
export class PortalAccessKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** What the key is for, e.g. "New lecturers, January 2027". */
  @Column({ length: 120 })
  name: string;

  /** HMAC-SHA-256 (hex) of the normalised key, with the server secret PORTAL_KEY_SECRET. */
  @Column({ type: 'char', length: 64, unique: true, select: false })
  keyHash: string;

  /** Last group of the key, so admins can tell keys apart without seeing them. */
  @Column({ type: 'char', length: 5 })
  keyHint: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  createdBy: Relation<User> | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime' })
  expiresAt: Date;

  /** How many staff members can use this link (1 for a personal link). */
  @Column({ type: 'int', unsigned: true })
  maxUses: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  currentUses: number;

  @Column({ type: 'enum', enum: PortalKeyStatus, default: PortalKeyStatus.Active })
  status: PortalKeyStatus;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  revokedBy: Relation<User> | null;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt: Date | null;
}

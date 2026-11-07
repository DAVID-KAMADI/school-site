import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { PortalAccessKey } from './portal-access-key.entity.js';
import { User } from './user.entity.js';

export type PortalAccessEvent =
  /** An administrator generated a key. */
  | 'key_created'
  /** An administrator revoked a key. */
  | 'key_revoked'
  /** Someone entered a key on the access page (success or failure, see `success` and `details.reason`). */
  | 'key_verified'
  /** Too many wrong keys from one address: the attempt was refused without checking. */
  | 'key_blocked'
  /** A staff member signed in through a key or a remembered device. */
  | 'staff_login'
  /** A staff account tried to sign in without passing the access step. */
  | 'staff_login_denied';

/** Security log for the staff portal access step. Failed attempts here also drive brute-force blocking. */
@Entity('admin_portal_access_logs')
@Index(['ipAddress', 'createdAt'])
@Index(['key', 'createdAt'])
export class PortalAccessLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @ManyToOne(() => PortalAccessKey, { onDelete: 'SET NULL', nullable: true })
  key: Relation<PortalAccessKey> | null;

  @Column({ length: 40 })
  event: PortalAccessEvent;

  @Column()
  success: boolean;

  /** The administrator who acted, or the staff member who signed in. */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  user: Relation<User> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @Column({ type: 'json', nullable: true })
  details: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime', precision: 6 })
  createdAt: Date;
}

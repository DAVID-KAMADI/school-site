import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../identity/entities/user.entity.js';

@Entity('audit_logs')
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** Null for system actions. Kept when the user is deleted so the history stays intact. */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  user: Relation<User> | null;

  /** e.g. "page.publish", "settings.update", "auth.login_failed". */
  @Index()
  @Column({ length: 100 })
  action: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  entityId: string | null;

  @Column({ type: 'json', nullable: true })
  details: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}

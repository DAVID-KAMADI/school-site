import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';
import { Application } from './application.entity.js';

/**
 * History of an application: status changes, notes, messages and reviews.
 * Entries with visibleToApplicant appear on the applicant's status page.
 */
@Entity('application_events')
@Index(['application', 'createdAt'])
export class ApplicationEvent {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Application, { onDelete: 'CASCADE', nullable: false })
  application: Relation<Application>;

  /** status, note, message, applicant_reply, document, fee */
  @Column({ length: 30 })
  type: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  fromStatus: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  toStatus: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ default: false })
  visibleToApplicant: boolean;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  actor: Relation<User> | null;

  @CreateDateColumn()
  createdAt: Date;
}

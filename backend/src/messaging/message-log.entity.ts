import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Application } from '../admissions/entities/application.entity.js';
import { User } from '../identity/entities/user.entity.js';

export type MessageChannel = 'sms' | 'email';
/** follow_up: to an applicant from Admissions → Follow-ups; test: from SMS & email settings. */
export type MessagePurpose = 'follow_up' | 'test';

/** Every SMS and email the site sends, with what the provider answered. */
@Entity('message_log')
@Index(['recipientUser', 'createdAt'])
export class MessageLog {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 10 })
  channel: MessageChannel;

  @Column({ type: 'varchar', length: 20 })
  purpose: MessagePurpose;

  /** Phone number (+2547…) or email address it went to. */
  @Column({ type: 'varchar', length: 200 })
  recipient: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  subject: string | null;

  @Column({ type: 'text' })
  body: string;

  /** sent: accepted by the provider. failed: refused, or could not be sent. */
  @Column({ type: 'varchar', length: 10 })
  status: 'sent' | 'failed';

  @Column({ type: 'varchar', length: 120, nullable: true })
  providerMessageId: string | null;

  /** The provider's own status, e.g. Africa's Talking "Success" or "InsufficientBalance". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  providerStatus: string | null;

  /** e.g. "KES 0.8000". */
  @Column({ type: 'varchar', length: 30, nullable: true })
  cost: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  error: string | null;

  /** The applicant it was for, if any. */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  recipientUser: Relation<User> | null;

  @ManyToOne(() => Application, { onDelete: 'SET NULL', nullable: true })
  application: Relation<Application> | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  sentBy: Relation<User> | null;

  @CreateDateColumn()
  createdAt: Date;
}

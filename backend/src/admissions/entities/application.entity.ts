import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';
import { ApplicationDocument } from './application-document.entity.js';
import { Intake } from './intake.entity.js';
import { Programme } from './programme.entity.js';

export enum ApplicationStatus {
  Draft = 'draft',
  Submitted = 'submitted',
  UnderReview = 'under_review',
  InfoRequested = 'info_requested',
  Offered = 'offered',
  Rejected = 'rejected',
  Withdrawn = 'withdrawn',
  /** The applicant accepted an offer of admission. */
  Accepted = 'accepted',
  /** The applicant declined an offer of admission. */
  Declined = 'declined',
}

export enum FeeStatus {
  Unpaid = 'unpaid',
  /** Applicant entered an M-Pesa code; waiting for finance/admissions to confirm. */
  Claimed = 'claimed',
  Verified = 'verified',
}

/**
 * An application. Form sections are stored as JSON (validated by the section schemas);
 * a few fields are copied into columns so staff can search and filter.
 */
@Entity('applications')
@Index(['status', 'submittedAt'])
export class Application {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** Assigned on submission, e.g. "APP-2027-000042". */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40, nullable: true })
  applicationNumber: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  applicant: Relation<User>;

  @ManyToOne(() => Intake, { onDelete: 'RESTRICT', nullable: true })
  intake: Relation<Intake> | null;

  @ManyToOne(() => Programme, { onDelete: 'RESTRICT', nullable: true })
  programme: Relation<Programme> | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  studyMode: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.Draft,
  })
  status: ApplicationStatus;

  @Column({ type: 'json', nullable: true })
  personal: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  nextOfKin: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  education: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  funding: Record<string, unknown> | null;

  // Searchable copies
  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  fullName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, nullable: true })
  kcseIndexNumber: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  meanGrade: string | null;

  @Column({ type: 'datetime', nullable: true })
  declarationAcceptedAt: Date | null;

  @Column({ type: 'enum', enum: FeeStatus, default: FeeStatus.Unpaid })
  feeStatus: FeeStatus;

  @Column({ type: 'varchar', length: 20, nullable: true })
  feeReference: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  feeVerifiedBy: Relation<User> | null;

  @Column({ type: 'datetime', nullable: true })
  feeVerifiedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  decidedAt: Date | null;

  /** When the applicant accepted or declined the offer. */
  @Column({ type: 'datetime', nullable: true })
  respondedAt: Date | null;

  @OneToMany(() => ApplicationDocument, (d) => d.application)
  documents: Relation<ApplicationDocument[]>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

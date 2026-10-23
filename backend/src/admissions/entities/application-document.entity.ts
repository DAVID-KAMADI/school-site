import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';
import { Application } from './application.entity.js';
import { DocumentType } from './document-type.entity.js';

export enum DocumentReviewStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Rejected = 'rejected',
}

/** A file an applicant uploaded. Stored privately; only the applicant and admissions staff can open it. */
@Entity('application_documents')
export class ApplicationDocument {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Application, (a) => a.documents, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  application: Relation<Application>;

  @ManyToOne(() => DocumentType, {
    onDelete: 'RESTRICT',
    nullable: false,
    eager: true,
  })
  documentType: Relation<DocumentType>;

  @Column({ length: 255 })
  originalName: string;

  @Column({ length: 191, unique: true })
  storageKey: string;

  @Column({ length: 100 })
  mimeType: string;

  @Column({ type: 'int', unsigned: true })
  sizeBytes: number;

  @Column({
    type: 'enum',
    enum: DocumentReviewStatus,
    default: DocumentReviewStatus.Pending,
  })
  status: DocumentReviewStatus;

  /** Shown to the applicant when a document is rejected, e.g. "Photo is blurred". */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reviewNote: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  reviewedBy: Relation<User> | null;

  @Column({ type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn()
  uploadedAt: Date;
}

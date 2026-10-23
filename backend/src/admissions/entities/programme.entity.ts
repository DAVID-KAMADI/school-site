import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProgrammeLevel {
  Certificate = 'certificate',
  Diploma = 'diploma',
  Degree = 'degree',
  Postgraduate = 'postgraduate',
  ShortCourse = 'short_course',
}

/** A programme applicants can choose. Managed by admissions staff in the admin. */
@Entity('programmes')
export class Programme {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index({ unique: true })
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ProgrammeLevel })
  level: ProgrammeLevel;

  /** Course area, e.g. "Business & Management". Stored as "school" for compatibility. */
  @Column({ length: 150 })
  school: string;

  /** e.g. "2 years". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  duration: string | null;

  /** Study modes offered, e.g. ["full_time", "evening"]. */
  @Column({ type: 'json' })
  studyModes: string[];

  /** Minimum KCSE mean grade, e.g. "C-". Used to warn, not block. */
  @Column({ type: 'varchar', length: 3, nullable: true })
  minMeanGrade: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CourseDelivery {
  InPerson = 'in_person',
  Online = 'online',
  Blended = 'blended',
}

/**
 * A short course (days or weeks, no KCSE entry requirement). Managed in the admin and shown on the
 * website by the "Short courses" and "Programmes" blocks. People enquire rather than apply online.
 */
@Entity('short_courses')
export class ShortCourse {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 200 })
  title: string;

  /** Groups courses on the site, e.g. "ICT" or "Business". */
  @Column({ length: 100, default: '' })
  category: string;

  /** One or two sentences shown on the course card. */
  @Column({ length: 500, default: '' })
  summary: string;

  /** e.g. "5 days" or "6 weeks". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  duration: string | null;

  /** Shown as written, e.g. "KSh 15,000". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  fee: string | null;

  @Column({
    type: 'enum',
    enum: CourseDelivery,
    default: CourseDelivery.InPerson,
  })
  delivery: CourseDelivery;

  /** When classes meet, e.g. "Saturdays, 9am–1pm". */
  @Column({ type: 'varchar', length: 150, nullable: true })
  schedule: string | null;

  /** Next class start date (YYYY-MM-DD). Past dates are not shown. */
  @Column({ type: 'date', nullable: true })
  nextStartOn: string | null;

  /** Photo from the media library. */
  @Column({ type: 'int', unsigned: true, nullable: true })
  imageId: number | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

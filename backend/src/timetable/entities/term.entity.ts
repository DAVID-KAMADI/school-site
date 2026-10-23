import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import {
  TtClass,
  TtLecturer,
  TtRoom,
  TtUnit,
  type RoomType,
} from './resources.entity.js';

export enum TermStatus {
  Draft = 'draft',
  Published = 'published',
}

/** A teaching period (semester or term) with its own weekly timetable. */
@Entity('tt_terms')
export class TtTerm {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'date' })
  startsOn: string;

  @Column({ type: 'date' })
  endsOn: string;

  /** Teaching days, 1 = Monday … 7 = Sunday. */
  @Column({ type: 'json' })
  days: number[];

  @Column({ type: 'enum', enum: TermStatus, default: TermStatus.Draft })
  status: TermStatus;

  @Column({ type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** One period of the teaching day, e.g. 08:00–09:00. A session can never run across a break. */
@Entity('tt_periods')
@Index(['term', 'sortOrder'])
export class TtPeriod {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => TtTerm, { onDelete: 'CASCADE', nullable: false })
  term: Relation<TtTerm>;

  @Column({ type: 'smallint', unsigned: true })
  sortOrder: number;

  @Column({ length: 5 })
  startsAt: string;

  @Column({ length: 5 })
  endsAt: string;

  /** Tea or lunch break: nothing is scheduled in it. */
  @Column({ default: false })
  isBreak: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  label: string | null;
}

/**
 * What must be taught: a unit, to one or more classes (combined classes sit together),
 * by a lecturer, `sessionsPerWeek` times, each session `length` periods long.
 */
@Entity('tt_lessons')
export class TtLesson {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => TtTerm, { onDelete: 'CASCADE', nullable: false })
  term: Relation<TtTerm>;

  @ManyToOne(() => TtUnit, { onDelete: 'RESTRICT', nullable: false })
  unit: Relation<TtUnit>;

  @ManyToOne(() => TtLecturer, { onDelete: 'RESTRICT', nullable: false })
  lecturer: Relation<TtLecturer>;

  @ManyToMany(() => TtClass)
  @JoinTable({
    name: 'tt_lesson_classes',
    joinColumn: { name: 'lesson_id' },
    inverseJoinColumn: { name: 'class_id' },
  })
  classes: Relation<TtClass[]>;

  @Column({ type: 'tinyint', unsigned: true })
  sessionsPerWeek: number;

  /** Periods per session (2 = a double lesson). */
  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  length: number;

  /** Overrides the unit's room type for this lesson; null = use the unit's. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  roomType: RoomType | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;
}

/** One weekly occurrence of a lesson. Unplaced while day, startPeriod and room are null. */
@Entity('tt_sessions')
@Index(['term', 'day'])
export class TtSession {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => TtLesson, { onDelete: 'CASCADE', nullable: false })
  lesson: Relation<TtLesson>;

  @ManyToOne(() => TtTerm, { onDelete: 'CASCADE', nullable: false })
  term: Relation<TtTerm>;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  day: number | null;

  @ManyToOne(() => TtPeriod, { onDelete: 'SET NULL', nullable: true })
  startPeriod: Relation<TtPeriod> | null;

  @ManyToOne(() => TtRoom, { onDelete: 'SET NULL', nullable: true })
  room: Relation<TtRoom> | null;

  /** Locked sessions are never moved by automatic generation. */
  @Column({ default: false })
  locked: boolean;
}

/**
 * What a placed session occupies, one row per period: its room, its lecturer and each of its classes.
 * The unique index makes a double booking impossible, even if two people save at the same moment.
 */
@Entity('tt_slots')
@Index(['term', 'day', 'period', 'kind', 'resourceId'], { unique: true })
export class TtSlot {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => TtTerm, { onDelete: 'CASCADE', nullable: false })
  term: Relation<TtTerm>;

  @ManyToOne(() => TtSession, { onDelete: 'CASCADE', nullable: false })
  session: Relation<TtSession>;

  @Column({ type: 'tinyint', unsigned: true })
  day: number;

  @ManyToOne(() => TtPeriod, { onDelete: 'CASCADE', nullable: false })
  period: Relation<TtPeriod>;

  @Column({ type: 'enum', enum: ['room', 'lecturer', 'class'] })
  kind: 'room' | 'lecturer' | 'class';

  @Column({ type: 'int', unsigned: true })
  resourceId: number;
}

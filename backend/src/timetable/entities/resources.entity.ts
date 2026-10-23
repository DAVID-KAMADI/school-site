import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Programme } from '../../admissions/entities/programme.entity.js';

/** Kinds of teaching space. A unit that needs a lab is only ever placed in a lab. */
export const ROOM_TYPES = [
  'classroom',
  'lab',
  'computer_lab',
  'workshop',
  'hall',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** A teaching room, lab or workshop. Shared by every term. */
@Entity('tt_rooms')
export class TtRoom {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index({ unique: true })
  @Column({ length: 100 })
  name: string;

  @Column({ type: 'smallint', unsigned: true })
  capacity: number;

  @Column({ type: 'varchar', length: 30, default: 'classroom' })
  type: RoomType;

  @Column({ type: 'varchar', length: 300, nullable: true })
  notes: string | null;

  @Column({ default: true })
  isActive: boolean;
}

/** A time a lecturer cannot teach, e.g. { day: 3, from: "14:00", to: "17:00" } (day 1 = Monday). */
export interface Unavailability {
  day: number;
  from: string;
  to: string;
}

/** A person who teaches. Not necessarily a user of the admin portal. */
@Entity('tt_lecturers')
export class TtLecturer {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  department: string | null;

  /** Most periods this lecturer may teach in one day; null = no limit. */
  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  maxPeriodsPerDay: number | null;

  @Column({ type: 'json' })
  unavailable: Unavailability[];

  @Column({ default: true })
  isActive: boolean;
}

/** A group of students taught together, e.g. "Diploma in ICT, Sept 2026, Year 1". */
@Entity('tt_classes')
export class TtClass {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index({ unique: true })
  @Column({ length: 150 })
  name: string;

  @ManyToOne(() => Programme, { onDelete: 'SET NULL', nullable: true })
  programme: Relation<Programme> | null;

  /** Number of students; rooms must hold everyone in a lesson. */
  @Column({ type: 'smallint', unsigned: true })
  size: number;

  @Column({ default: true })
  isActive: boolean;
}

/** A unit (subject / course module), e.g. "ICT 201 Database Systems". */
@Entity('tt_units')
export class TtUnit {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index({ unique: true })
  @Column({ length: 30 })
  code: string;

  @Column({ length: 200 })
  name: string;

  /** Kind of room it must be taught in; null = an ordinary classroom. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  roomType: RoomType | null;

  @Column({ default: true })
  isActive: boolean;
}

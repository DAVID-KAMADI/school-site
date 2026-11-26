import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { StaffLevel } from './staff-level.entity.js';

/** A person shown on the Our people page, made in Admin → Staff hierarchy. */
@Entity('staff_members')
@Index(['level', 'sortOrder'])
export class StaffMember {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => StaffLevel, (l) => l.members, {
    onDelete: 'RESTRICT',
    nullable: false,
  })
  level: Relation<StaffLevel>;

  @Column({ type: 'int', unsigned: true })
  levelId: number;

  /** Full name with any title, e.g. "Dr. Jane Wanjiru". */
  @Column({ length: 120 })
  name: string;

  /** Role, e.g. "Principal", "Head of Computing & Engineering". */
  @Column({ length: 120 })
  position: string;

  /** Course area or office, e.g. "Health Sciences", "Finance". */
  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ type: 'int', unsigned: true, nullable: true })
  photoId: number | null;

  /** Short profile shown when a visitor opens the card. Plain text. */
  @Column({ type: 'text', nullable: true })
  bio: string | null;

  /** Optional public contact details. Leave empty to keep them off the website. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ default: true })
  isPublished: boolean;

  /** Order within the tier; lower shows first. */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

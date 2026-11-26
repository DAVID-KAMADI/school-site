import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { StaffMember } from './staff-member.entity.js';

/**
 * One tier of the institute's hierarchy on the Our people page (/staff), top first:
 * e.g. Board of Governors, Principal's office, Heads of department, Lecturers, Support staff.
 */
@Entity('staff_levels')
export class StaffLevel {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  /** Lower is higher up the hierarchy. */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => StaffMember, (m) => m.level)
  members: Relation<StaffMember[]>;
}

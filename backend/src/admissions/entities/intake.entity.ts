import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** An intake applicants can apply for, e.g. "September 2027". Open between opensAt and closesAt. */
@Entity('intakes')
export class Intake {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'datetime' })
  opensAt: Date;

  @Column({ type: 'datetime' })
  closesAt: Date;

  /** When classes begin (shown to applicants). */
  @Column({ type: 'date', nullable: true })
  startsOn: string | null;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

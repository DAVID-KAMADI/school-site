import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** Stable machine key, e.g. "pages.publish". */
  @Column({ length: 100, unique: true })
  key: string;

  @Column({ length: 255 })
  description: string;

  /** Group in the access control matrix, e.g. "Admissions". */
  @Column({ length: 40, default: 'Other' })
  module: string;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  sortOrder: number;
}

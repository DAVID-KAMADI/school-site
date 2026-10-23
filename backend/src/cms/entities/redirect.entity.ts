import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Old URL to new URL, created when pages move or are deleted and when migrating from the old site. */
@Entity('redirects')
export class Redirect {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 191, unique: true })
  fromPath: string;

  @Column({ length: 500 })
  toPath: string;

  @Column({ type: 'smallint', unsigned: true, default: 301 })
  statusCode: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  hitCount: number;

  @CreateDateColumn()
  createdAt: Date;
}

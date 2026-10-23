import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Media } from './media.entity.js';

/** A resized or converted copy of an image (e.g. 640px WebP) generated on upload. */
@Entity('media_variants')
@Index(['media', 'width', 'format'], { unique: true })
export class MediaVariant {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Media, (media) => media.variants, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  media: Relation<Media>;

  @Column({ length: 10 })
  format: string;

  @Column({ type: 'smallint', unsigned: true })
  width: number;

  @Column({ type: 'smallint', unsigned: true })
  height: number;

  @Column({ length: 500 })
  storageKey: string;

  @Column({ type: 'int', unsigned: true })
  sizeBytes: number;
}

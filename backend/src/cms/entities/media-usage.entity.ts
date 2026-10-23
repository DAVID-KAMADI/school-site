import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Media } from './media.entity.js';

/** Where a media item is used, for the "where used" list and safe-delete warnings. */
@Entity('media_usage')
@Index(['media', 'entityType', 'entityId', 'fieldPath'], { unique: true })
@Index(['entityType', 'entityId'])
export class MediaUsage {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Media, { onDelete: 'CASCADE', nullable: false })
  media: Relation<Media>;

  /** e.g. "page_block", "page", "menu_item", "site_setting". */
  @Column({ length: 50 })
  entityType: string;

  @Column({ length: 50 })
  entityId: string;

  /** Field inside the entity, e.g. "content.image" or "content.slides.2.image". */
  @Column({ length: 150 })
  fieldPath: string;
}

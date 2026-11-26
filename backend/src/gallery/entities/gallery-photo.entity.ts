import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { GalleryAlbum } from './gallery-album.entity.js';

/** One photo in a gallery album. The image itself lives in the media library. */
@Entity('gallery_photos')
@Index(['album', 'sortOrder'])
export class GalleryPhoto {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => GalleryAlbum, (a) => a.photos, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  album: Relation<GalleryAlbum>;

  @Column({ type: 'int', unsigned: true })
  albumId: number;

  @Column({ type: 'int', unsigned: true })
  mediaId: number;

  /** Shown under the photo in the viewer. Empty: the caption from the media library. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  caption: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}

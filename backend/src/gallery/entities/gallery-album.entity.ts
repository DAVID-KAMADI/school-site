import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { GalleryPhoto } from './gallery-photo.entity.js';

/**
 * A photo album on the website's Gallery page (/gallery), made in Admin → Gallery:
 * a graduation, a sports day, the campus, a field trip.
 */
@Entity('gallery_albums')
export class GalleryAlbum {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 120 })
  title: string;

  /** The album's address: /gallery/<slug>. */
  @Column({ length: 140, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  /** Groups albums into the filter chips on the Gallery page, e.g. "Events", "Campus", "Sports". */
  @Column({ type: 'varchar', length: 60, nullable: true })
  category: string | null;

  /** Cover photo. Empty: the album's first photo. */
  @Column({ type: 'int', unsigned: true, nullable: true })
  coverImageId: number | null;

  /** When the photos were taken. Shown on the album and used to sort albums newest first. */
  @Column({ type: 'date', nullable: true })
  takenOn: string | null;

  @Column({ default: true })
  isPublished: boolean;

  /** Shown large at the top of the Gallery page. */
  @Column({ default: false })
  isFeatured: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => GalleryPhoto, (p) => p.album)
  photos: Relation<GalleryPhoto[]>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

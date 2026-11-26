import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
  type Relation,
} from 'typeorm';
import { DownloadCategory } from './download-category.entity.js';

/**
 * One document visitors can download from /downloads: a tender, a job advert, a form, a report.
 * The file itself lives in the media library (PDF, Word, Excel, PowerPoint or an image).
 */
@Entity('downloads')
@Index('IDX_downloads_category', ['categoryId', 'isPublished'])
export class Download {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ type: 'int', unsigned: true })
  categoryId: number;

  @ManyToOne(() => DownloadCategory, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'category_id' })
  category: Relation<DownloadCategory>;

  @Column({ length: 200 })
  title: string;

  /** Tender or job reference number, e.g. "RCI/T/004/2026". */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  summary: string | null;

  /** The file, from the media library. */
  @Column({ type: 'int', unsigned: true })
  mediaId: number;

  /** The date shown as "Posted". */
  @Column({ type: 'date' })
  publishedOn: string;

  /** Deadline for tenders and job adverts. After it the document shows as closed. */
  @Column({ type: 'datetime', nullable: true })
  closesAt: Date | null;

  @Column({ default: true })
  isPublished: boolean;

  /** Kept at the top of its list, e.g. an important notice. */
  @Column({ default: false })
  isPinned: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

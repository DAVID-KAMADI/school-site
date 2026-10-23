import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';
import { Page } from './page.entity.js';

export interface PageSnapshot {
  title: string;
  template: string;
  seoTitle: string | null;
  metaDescription: string | null;
  socialImageId: number | null;
  blocks: {
    type: string;
    isHidden: boolean;
    content: Record<string, unknown>;
  }[];
}

/** Snapshot of a page, written on every save. Restoring copies a snapshot back to the draft. */
@Entity('page_revisions')
@Index(['page', 'revisionNumber'], { unique: true })
export class PageRevision {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Page, { onDelete: 'CASCADE', nullable: false })
  page: Relation<Page>;

  @Column({ type: 'int', unsigned: true })
  revisionNumber: number;

  @Column({ type: 'json' })
  snapshot: PageSnapshot;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  createdBy: Relation<User> | null;

  @CreateDateColumn()
  createdAt: Date;
}

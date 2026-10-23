import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';
import { Media } from './media.entity.js';
import { PageBlock } from './page-block.entity.js';
import { PageRevision } from './page-revision.entity.js';

export enum PageTemplate {
  Standard = 'standard',
  Landing = 'landing',
  FullWidth = 'full_width',
  SideNav = 'side_nav',
}

export enum PageStatus {
  Draft = 'draft',
  InReview = 'in_review',
  Published = 'published',
  Archived = 'archived',
}

export enum PageVisibility {
  Public = 'public',
  Applicants = 'applicants',
  Students = 'students',
}

/**
 * A CMS page. Its blocks are the working draft; visitors are served the snapshot in
 * publishedRevision, so editors can change a live page without affecting it until they publish.
 * Deleting a page soft-deletes it (trash) so it can be restored.
 */
@Entity('pages')
export class Page {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Page, { onDelete: 'RESTRICT', nullable: true })
  parent: Relation<Page> | null;

  @Column({ length: 200 })
  title: string;

  /** Last URL segment, e.g. "history". Empty string for the home page. */
  @Column({ length: 150 })
  slug: string;

  /** Full URL path built from parent slugs, e.g. "/about/history". Unique among pages. */
  @Index({ unique: true })
  @Column({ length: 500 })
  path: string;

  @Column({ type: 'enum', enum: PageTemplate, default: PageTemplate.Standard })
  template: PageTemplate;

  @Index()
  @Column({ type: 'enum', enum: PageStatus, default: PageStatus.Draft })
  status: PageStatus;

  @Column({
    type: 'enum',
    enum: PageVisibility,
    default: PageVisibility.Public,
  })
  visibility: PageVisibility;

  @Column({ type: 'varchar', length: 200, nullable: true })
  seoTitle: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  metaDescription: string | null;

  @ManyToOne(() => Media, { onDelete: 'SET NULL', nullable: true })
  socialImage: Relation<Media> | null;

  @Column({ type: 'datetime', nullable: true })
  publishAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  unpublishAt: Date | null;

  @ManyToOne(() => PageRevision, { onDelete: 'SET NULL', nullable: true })
  publishedRevision: Relation<PageRevision> | null;

  /** Editor currently editing the page, so a second editor is warned. */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  lockedBy: Relation<User> | null;

  @Column({ type: 'datetime', nullable: true })
  lockedAt: Date | null;

  @OneToMany(() => PageBlock, (block) => block.page)
  blocks: Relation<PageBlock[]>;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  createdBy: Relation<User> | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  updatedBy: Relation<User> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}

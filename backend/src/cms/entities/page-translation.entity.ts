import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';
import { Page } from './page.entity.js';

export interface TranslatedBlock {
  type: string;
  isHidden: boolean;
  content: Record<string, unknown>;
}

/** What visitors are served for a translated page. Layout and address come from the English page. */
export interface TranslationSnapshot {
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  blocks: TranslatedBlock[];
}

/**
 * A page in another language (e.g. French at /fr/admissions). It starts as a copy of the
 * English blocks; editors translate the words and publish it separately. Until a translation
 * is published, visitors to /fr/... see the English page with a notice.
 */
@Entity('page_translations')
@Index(['page', 'locale'], { unique: true })
export class PageTranslation {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Page, { onDelete: 'CASCADE', nullable: false })
  page: Relation<Page>;

  /** Two-letter language code, e.g. "fr". English is the page itself, never a translation. */
  @Column({ length: 10 })
  locale: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  seoTitle: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  metaDescription: string | null;

  /** The working draft. */
  @Column({ type: 'json' })
  blocks: TranslatedBlock[];

  /** The live version, or null while the translation is unpublished. */
  @Column({ type: 'json', nullable: true })
  published: TranslationSnapshot | null;

  /** English revision the draft was last saved against, to warn when the English page has changed since. */
  @Column({ type: 'int', unsigned: true, nullable: true })
  sourceRevision: number | null;

  @Column({ type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  updatedBy: Relation<User> | null;

  @UpdateDateColumn()
  updatedAt: Date;
}

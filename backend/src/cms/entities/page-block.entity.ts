import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { Page } from './page.entity.js';

/**
 * One content block on a page (hero, rich_text, image_gallery, cards, faq, ...).
 * `content` holds the block's editable fields and is validated against the schema for `type`.
 */
@Entity('page_blocks')
@Index(['page', 'sortOrder'])
export class PageBlock {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Page, (page) => page.blocks, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  page: Relation<Page>;

  @Column({ length: 50 })
  type: string;

  @Column({ type: 'smallint', unsigned: true })
  sortOrder: number;

  @Column({ default: false })
  isHidden: boolean;

  @Column({ type: 'json' })
  content: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

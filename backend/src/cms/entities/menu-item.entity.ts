import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Menu } from './menu.entity.js';
import { Page } from './page.entity.js';

/** A menu link to a CMS page or an external URL. Items nest via parent for dropdowns. */
@Entity('menu_items')
@Index(['menu', 'parent', 'sortOrder'])
export class MenuItem {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => Menu, (menu) => menu.items, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  menu: Relation<Menu>;

  @ManyToOne(() => MenuItem, { onDelete: 'CASCADE', nullable: true })
  parent: Relation<MenuItem> | null;

  @Column({ length: 100 })
  label: string;

  /** Label in other languages, e.g. { "fr": "Admissions" }. Missing languages use `label`. */
  @Column({ type: 'json', nullable: true })
  translations: Record<string, string> | null;

  @ManyToOne(() => Page, { onDelete: 'SET NULL', nullable: true })
  page: Relation<Page> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  url: string | null;

  @Column({ default: false })
  openInNewTab: boolean;

  /** Shows the item as a button (e.g. "Apply Now") instead of a plain link. */
  @Column({ default: false })
  isButton: boolean;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isVisible: boolean;
}

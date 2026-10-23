import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { MenuItem } from './menu-item.entity.js';

@Entity('menus')
export class Menu {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** Where the menu renders: "main", "utility", "footer", or a section menu key. */
  @Column({ length: 50, unique: true })
  location: string;

  @Column({ length: 100 })
  name: string;

  @OneToMany(() => MenuItem, (item) => item.menu)
  items: Relation<MenuItem[]>;
}

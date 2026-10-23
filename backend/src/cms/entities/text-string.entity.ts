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

/**
 * Editable interface text (button labels, form labels, error and empty-state messages).
 * One row per key and locale, so a Kiswahili ("sw") version can be added later.
 */
@Entity('text_strings')
@Index(['key', 'locale'], { unique: true })
export class TextString {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  /** e.g. "header.apply_button", "form.required_field". */
  @Column({ length: 150 })
  key: string;

  @Column({ length: 10, default: 'en' })
  locale: string;

  @Column({ type: 'text' })
  value: string;

  /** Tells editors where the text appears. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  updatedBy: Relation<User> | null;

  @UpdateDateColumn()
  updatedAt: Date;
}

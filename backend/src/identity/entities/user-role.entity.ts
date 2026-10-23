import {
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { Page } from '../../cms/entities/page.entity.js';
import { Role } from './role.entity.js';
import { User } from './user.entity.js';

/**
 * Grants a role to a user. When scopePage is set, the role only applies to that page and
 * its child pages (e.g. the Library editor can edit only the Library section).
 */
@Entity('user_roles')
@Index(['user', 'role', 'scopePage'], { unique: true })
export class UserRole {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @ManyToOne(() => User, (user) => user.roles, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  user: Relation<User>;

  @ManyToOne(() => Role, { onDelete: 'CASCADE', nullable: false, eager: true })
  role: Relation<Role>;

  @ManyToOne(() => Page, { onDelete: 'CASCADE', nullable: true })
  scopePage: Relation<Page> | null;

  @CreateDateColumn()
  createdAt: Date;
}

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
import { User } from '../../identity/entities/user.entity.js';
import { Media } from '../../cms/entities/media.entity.js';

export enum BlogPostStatus {
  Draft = 'draft',
  Published = 'published',
}

@Entity('blog_posts')
@Index(['status', 'publishedAt'])
export class BlogPost {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 200 })
  title: string;

  @Index({ unique: true })
  @Column({ length: 180 })
  slug: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  excerpt: string;

  @Column({ type: 'longtext' })
  content: string;

  @Column({ type: 'enum', enum: BlogPostStatus, default: BlogPostStatus.Draft })
  status: BlogPostStatus;

  @ManyToOne(() => Media, { onDelete: 'SET NULL', nullable: true })
  coverImage: Relation<Media> | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  author: Relation<User> | null;

  @Column({ type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

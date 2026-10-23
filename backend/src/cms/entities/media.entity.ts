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
import { MediaVariant } from './media-variant.entity.js';

/** An uploaded image or document. Replacing the file keeps the same id, so every usage updates. */
@Entity('media')
export class Media {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 255 })
  originalName: string;

  /** Location in file/object storage. */
  @Column({ length: 191, unique: true })
  storageKey: string;

  @Column({ length: 100 })
  mimeType: string;

  @Column({ type: 'int', unsigned: true })
  sizeBytes: number;

  @Column({ type: 'smallint', unsigned: true, nullable: true })
  width: number | null;

  @Column({ type: 'smallint', unsigned: true, nullable: true })
  height: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  altText: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  credit: string | null;

  /** Confirms photo consent / image rights for identifiable people. */
  @Column({ default: false })
  hasConsent: boolean;

  /** Focal point as fractions of width and height (0 to 1), used when cropping for mobile. */
  @Column({ type: 'decimal', precision: 4, scale: 3, default: 0.5 })
  focalX: string;

  @Column({ type: 'decimal', precision: 4, scale: 3, default: 0.5 })
  focalY: string;

  @Index()
  @Column({ type: 'varchar', length: 150, nullable: true })
  folder: string | null;

  @OneToMany(() => MediaVariant, (variant) => variant.media)
  variants: Relation<MediaVariant[]>;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  uploadedBy: Relation<User> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date | null;
}

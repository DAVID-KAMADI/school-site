import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A document applicants upload (ID, KCSE certificate, photo…). Configured in the admin. */
@Entity('document_types')
export class DocumentType {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 150 })
  name: string;

  /** Guidance shown to applicants. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ default: true })
  isRequired: boolean;

  /** "image" (JPG/PNG), "pdf", or "any" (either). */
  @Column({ length: 10, default: 'any' })
  accepts: string;

  @Column({ type: 'tinyint', unsigned: true, default: 5 })
  maxSizeMb: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'smallint', unsigned: true, default: 0 })
  sortOrder: number;
}

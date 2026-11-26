import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A group of documents on the website's Downloads page (/downloads):
 * e.g. Tenders, Job vacancies, Forms, Reports & publications. Each has its own address, /downloads/<slug>,
 * which can be linked from the main menu.
 */
@Entity('download_categories')
export class DownloadCategory {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ length: 80 })
  name: string;

  @Column({ length: 90, unique: true })
  slug: string;

  /** A sentence shown above the documents of this category. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  description: string | null;

  /** Order of the tabs on the Downloads page. */
  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}

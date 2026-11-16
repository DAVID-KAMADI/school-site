import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const POPUP_KINDS = [
  'announcement',
  'event',
  'offer',
  'course',
  'news',
] as const;
export type PopupKind = (typeof POPUP_KINDS)[number];

/**
 * A website pop-up made in Admin → Pop-ups: an upcoming event, an offer, a new course, news.
 * Shown alongside the intake pop-ups, one card per pop-up, which visitors swipe between.
 */
@Entity('popups')
export class Popup {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 20, default: 'announcement' })
  kind: PopupKind;

  /** Small label above the title, e.g. "Open day". Defaults to the kind. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  label: string | null;

  @Column({ length: 120 })
  title: string;

  @Column({ type: 'text' })
  details: string;

  @Column({ type: 'int', unsigned: true, nullable: true })
  imageId: number | null;

  /** For events: when it takes place. Shown on the card; the pop-up stops once it has passed unless "Show until" says otherwise. */
  @Column({ type: 'datetime', nullable: true })
  eventAt: Date | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  buttonLabel: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  buttonLink: string | null;

  /** Shown from (empty: straight away). */
  @Column({ type: 'datetime', nullable: true })
  startsAt: Date | null;

  /** Shown until (empty: until switched off). */
  @Column({ type: 'datetime', nullable: true })
  endsAt: Date | null;

  @Column({ default: true })
  isActive: boolean;

  /** Shown first on the website, before intake pop-ups and the other pop-ups. */
  @Column({ default: false })
  isPriority: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

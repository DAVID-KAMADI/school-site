import {
  Column,
  Entity,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity.js';

/** Site-wide editable values: institution name, logo, contacts, social links, banners, Paybill, etc. */
@Entity('site_settings')
export class SiteSetting {
  /** e.g. "institution.name", "contact.phone", "banner.alert". */
  @PrimaryColumn({ length: 100 })
  key: string;

  @Column({ type: 'json' })
  value: unknown;

  @Column({ length: 50 })
  groupName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  updatedBy: Relation<User> | null;

  @UpdateDateColumn()
  updatedAt: Date;
}

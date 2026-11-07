import { CreateDateColumn, Entity, ManyToOne, PrimaryColumn, type Relation } from 'typeorm';
import { PortalAccessKey } from './portal-access-key.entity.js';
import { User } from './user.entity.js';

/**
 * The staff members a sign-in link belongs to: set when an administrator makes a link for someone,
 * or when someone first signs in through an unassigned link. Only these people can use it afterwards.
 */
@Entity('admin_portal_access_key_users')
export class PortalAccessKeyUser {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  keyId: string;

  @PrimaryColumn({ type: 'int', unsigned: true })
  userId: number;

  @ManyToOne(() => PortalAccessKey, { onDelete: 'CASCADE' })
  key: Relation<PortalAccessKey>;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: Relation<User>;

  @CreateDateColumn()
  createdAt: Date;
}

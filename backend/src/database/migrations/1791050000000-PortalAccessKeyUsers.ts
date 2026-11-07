import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The staff members each sign-in link belongs to (assigned when made, or taken at first sign-in). */
export class PortalAccessKeyUsers1791050000000 implements MigrationInterface {
  name = 'PortalAccessKeyUsers1791050000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`admin_portal_access_key_users\` (
        \`key_id\` varchar(36) NOT NULL,
        \`user_id\` int UNSIGNED NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`key_id\`, \`user_id\`),
        INDEX \`IDX_portal_key_users_user\` (\`user_id\`),
        CONSTRAINT \`FK_portal_key_users_key\` FOREIGN KEY (\`key_id\`) REFERENCES \`admin_portal_access_keys\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT \`FK_portal_key_users_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `admin_portal_access_key_users`');
  }
}

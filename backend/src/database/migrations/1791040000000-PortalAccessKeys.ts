import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff portal access keys: invitation keys that must be verified before the staff sign-in page,
 * their security log, and the permission to manage them (super administrators hold it automatically).
 */
export class PortalAccessKeys1791040000000 implements MigrationInterface {
  name = 'PortalAccessKeys1791040000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`admin_portal_access_keys\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(120) NOT NULL,
        \`key_hash\` char(64) NOT NULL,
        \`key_hint\` char(5) NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`expires_at\` datetime NOT NULL,
        \`max_uses\` int UNSIGNED NOT NULL,
        \`current_uses\` int UNSIGNED NOT NULL DEFAULT '0',
        \`status\` enum ('active', 'revoked') NOT NULL DEFAULT 'active',
        \`revoked_at\` datetime NULL,
        \`last_used_at\` datetime NULL,
        \`created_by_id\` int UNSIGNED NULL,
        \`revoked_by_id\` int UNSIGNED NULL,
        UNIQUE INDEX \`IDX_a5dba88091bf9e11882c849dde\` (\`key_hash\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_2dd8f146990a7d25c61b5d02bc2\` FOREIGN KEY (\`created_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT \`FK_50c5fd7a99cf22479744dd6b111\` FOREIGN KEY (\`revoked_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`admin_portal_access_logs\` (
        \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
        \`event\` varchar(40) NOT NULL,
        \`success\` tinyint NOT NULL,
        \`ip_address\` varchar(45) NULL,
        \`user_agent\` varchar(255) NULL,
        \`details\` json NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`key_id\` varchar(36) NULL,
        \`user_id\` int UNSIGNED NULL,
        INDEX \`IDX_b743e3b61a34b5b17bf438ba51\` (\`key_id\`, \`created_at\`),
        INDEX \`IDX_5b523a9abdec3a5d37ec806b38\` (\`ip_address\`, \`created_at\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_8f14429a3c932b1f93a954901a7\` FOREIGN KEY (\`key_id\`) REFERENCES \`admin_portal_access_keys\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT \`FK_91297e6a920a5c99c78186e6529\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
    await q.query(
      "INSERT INTO `permissions` (`key`, `description`, `module`, `sort_order`) VALUES ('portal_keys.manage', 'Generate, view and revoke staff portal access keys', 'Users & access', 93)",
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query("DELETE FROM `permissions` WHERE `key` = 'portal_keys.manage'");
    await q.query('DROP TABLE `admin_portal_access_logs`');
    await q.query('DROP TABLE `admin_portal_access_keys`');
  }
}

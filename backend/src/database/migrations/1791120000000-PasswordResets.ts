import type { MigrationInterface, QueryRunner } from 'typeorm';

/** "Forgot your password" links for applicants and students (only a hash of each link is stored). */
export class PasswordResets1791120000000 implements MigrationInterface {
  name = 'PasswordResets1791120000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`password_resets\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`token_hash\` char(64) NOT NULL,
        \`user_id\` int UNSIGNED NOT NULL,
        \`expires_at\` datetime NOT NULL,
        \`used_at\` datetime NULL,
        \`requested_ip\` varchar(45) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`UQ_password_resets_token\` (\`token_hash\`),
        INDEX \`IDX_password_resets_user_created\` (\`user_id\`, \`created_at\`),
        CONSTRAINT \`FK_password_resets_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `password_resets`');
  }
}

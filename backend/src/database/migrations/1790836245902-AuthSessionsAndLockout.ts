import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthSessionsAndLockout1790836245902 implements MigrationInterface {
  name = 'AuthSessionsAndLockout1790836245902';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`sessions\` (\`id\` char(64) NOT NULL, \`two_factor_verified\` tinyint NOT NULL DEFAULT 0, \`idle_minutes\` smallint UNSIGNED NOT NULL, \`last_seen_at\` datetime NOT NULL, \`expires_at\` datetime NOT NULL, \`ip_address\` varchar(45) NULL, \`user_agent\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`user_id\` int UNSIGNED NOT NULL, INDEX \`IDX_085d540d9f418cfbdc7bd55bb1\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`two_factor_enabled_at\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`two_factor_last_step\` bigint NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`failed_login_count\` smallint UNSIGNED NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`locked_until\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`password_changed_at\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sessions\` ADD CONSTRAINT \`FK_085d540d9f418cfbdc7bd55bb19\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`sessions\` DROP FOREIGN KEY \`FK_085d540d9f418cfbdc7bd55bb19\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`password_changed_at\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`locked_until\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`failed_login_count\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`two_factor_last_step\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`two_factor_enabled_at\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_085d540d9f418cfbdc7bd55bb1\` ON \`sessions\``,
    );
    await queryRunner.query(`DROP TABLE \`sessions\``);
  }
}

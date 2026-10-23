import { MigrationInterface, QueryRunner } from 'typeorm';

export class PageTranslations1790923800239 implements MigrationInterface {
  name = 'PageTranslations1790923800239';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`page_translations\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`locale\` varchar(10) NOT NULL, \`title\` varchar(200) NOT NULL, \`seo_title\` varchar(200) NULL, \`meta_description\` varchar(300) NULL, \`blocks\` json NOT NULL, \`published\` json NULL, \`source_revision\` int UNSIGNED NULL, \`published_at\` datetime NULL, \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`page_id\` int UNSIGNED NOT NULL, \`updated_by_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_9f6bfa9d10fd04a6fc418f819b\` (\`page_id\`, \`locale\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` ADD \`translations\` json NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_translations\` ADD CONSTRAINT \`FK_6d1cec12d03e88227d4fa28b6c4\` FOREIGN KEY (\`page_id\`) REFERENCES \`pages\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_translations\` ADD CONSTRAINT \`FK_abf97346f1d902136b8bfc6f6a2\` FOREIGN KEY (\`updated_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`page_translations\` DROP FOREIGN KEY \`FK_abf97346f1d902136b8bfc6f6a2\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_translations\` DROP FOREIGN KEY \`FK_6d1cec12d03e88227d4fa28b6c4\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` DROP COLUMN \`translations\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_9f6bfa9d10fd04a6fc418f819b\` ON \`page_translations\``,
    );
    await queryRunner.query(`DROP TABLE \`page_translations\``);
  }
}

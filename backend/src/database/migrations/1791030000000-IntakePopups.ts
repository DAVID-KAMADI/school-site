import { MigrationInterface, QueryRunner } from 'typeorm';

export class IntakePopups1791030000000 implements MigrationInterface {
  name = 'IntakePopups1791030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`intakes\`
       ADD \`popup_enabled\` tinyint NOT NULL DEFAULT 0,
       ADD \`popup_title\` varchar(120) NULL,
       ADD \`popup_details\` text NULL,
       ADD \`popup_image_id\` int UNSIGNED NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`intakes\`
       DROP COLUMN \`popup_image_id\`,
       DROP COLUMN \`popup_details\`,
       DROP COLUMN \`popup_title\`,
       DROP COLUMN \`popup_enabled\``,
    );
  }
}

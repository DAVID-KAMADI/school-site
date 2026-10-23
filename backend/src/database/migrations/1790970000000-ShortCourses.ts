import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShortCourses1790970000000 implements MigrationInterface {
  name = 'ShortCourses1790970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`short_courses\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`title\` varchar(200) NOT NULL,
        \`category\` varchar(100) NOT NULL DEFAULT '',
        \`summary\` varchar(500) NOT NULL DEFAULT '',
        \`duration\` varchar(60) NULL,
        \`fee\` varchar(60) NULL,
        \`delivery\` enum ('in_person', 'online', 'blended') NOT NULL DEFAULT 'in_person',
        \`schedule\` varchar(150) NULL,
        \`next_start_on\` date NULL,
        \`image_id\` int UNSIGNED NULL,
        \`is_active\` tinyint NOT NULL DEFAULT 1,
        \`sort_order\` smallint UNSIGNED NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX \`IDX_short_courses_active_sort\` (\`is_active\`, \`sort_order\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_short_courses_image\` FOREIGN KEY (\`image_id\`) REFERENCES \`media\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `short_courses`');
  }
}

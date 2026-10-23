import { MigrationInterface, QueryRunner } from 'typeorm';

export class Timetable1790931714694 implements MigrationInterface {
  name = 'Timetable1790931714694';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`tt_rooms\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(100) NOT NULL, \`capacity\` smallint UNSIGNED NOT NULL, \`type\` varchar(30) NOT NULL DEFAULT 'classroom', \`notes\` varchar(300) NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`IDX_ae7198bc494bf82b157cbda403\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_lecturers\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(150) NOT NULL, \`email\` varchar(255) NULL, \`department\` varchar(150) NULL, \`max_periods_per_day\` tinyint UNSIGNED NULL, \`unavailable\` json NOT NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_classes\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(150) NOT NULL, \`size\` smallint UNSIGNED NOT NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, \`programme_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_fdd0e87958c0d8122865a7c32d\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_units\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`code\` varchar(30) NOT NULL, \`name\` varchar(200) NOT NULL, \`room_type\` varchar(30) NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, UNIQUE INDEX \`IDX_51c44dcb08ad0e1d38c59ac5ba\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_terms\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(150) NOT NULL, \`starts_on\` date NOT NULL, \`ends_on\` date NOT NULL, \`days\` json NOT NULL, \`status\` enum ('draft', 'published') NOT NULL DEFAULT 'draft', \`published_at\` datetime NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_periods\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`sort_order\` smallint UNSIGNED NOT NULL, \`starts_at\` varchar(5) NOT NULL, \`ends_at\` varchar(5) NOT NULL, \`is_break\` tinyint NOT NULL DEFAULT 0, \`label\` varchar(50) NULL, \`term_id\` int UNSIGNED NOT NULL, INDEX \`IDX_0b32ed2388b6b2ee20a516a568\` (\`term_id\`, \`sort_order\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_lessons\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`sessions_per_week\` tinyint UNSIGNED NOT NULL, \`length\` tinyint UNSIGNED NOT NULL DEFAULT '1', \`room_type\` varchar(30) NULL, \`notes\` varchar(300) NULL, \`term_id\` int UNSIGNED NOT NULL, \`unit_id\` int UNSIGNED NOT NULL, \`lecturer_id\` int UNSIGNED NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_sessions\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`day\` tinyint UNSIGNED NULL, \`locked\` tinyint NOT NULL DEFAULT 0, \`lesson_id\` int UNSIGNED NOT NULL, \`term_id\` int UNSIGNED NOT NULL, \`start_period_id\` int UNSIGNED NULL, \`room_id\` int UNSIGNED NULL, INDEX \`IDX_40b84b3a52225706a4c98709d7\` (\`term_id\`, \`day\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_slots\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`day\` tinyint UNSIGNED NOT NULL, \`kind\` enum ('room', 'lecturer', 'class') NOT NULL, \`resource_id\` int UNSIGNED NOT NULL, \`term_id\` int UNSIGNED NOT NULL, \`session_id\` int UNSIGNED NOT NULL, \`period_id\` int UNSIGNED NOT NULL, UNIQUE INDEX \`IDX_656de59dca2c8c3f344c343534\` (\`term_id\`, \`day\`, \`period_id\`, \`kind\`, \`resource_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tt_lesson_classes\` (\`lesson_id\` int UNSIGNED NOT NULL, \`class_id\` int UNSIGNED NOT NULL, INDEX \`IDX_944a929bc9430fea8a04409828\` (\`lesson_id\`), INDEX \`IDX_a602706734306d7d6008249b9e\` (\`class_id\`), PRIMARY KEY (\`lesson_id\`, \`class_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_classes\` ADD CONSTRAINT \`FK_932b43b3d9ce52b8a1f2fac5bdc\` FOREIGN KEY (\`programme_id\`) REFERENCES \`programmes\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_periods\` ADD CONSTRAINT \`FK_9e8ebca4d5185c1985b7071876d\` FOREIGN KEY (\`term_id\`) REFERENCES \`tt_terms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lessons\` ADD CONSTRAINT \`FK_a96acae6873c5a04968cff2fcd4\` FOREIGN KEY (\`term_id\`) REFERENCES \`tt_terms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lessons\` ADD CONSTRAINT \`FK_cf9306d17c6ee4c3ba4002bd116\` FOREIGN KEY (\`unit_id\`) REFERENCES \`tt_units\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lessons\` ADD CONSTRAINT \`FK_6b9e1b88c56d20f380b24014a5d\` FOREIGN KEY (\`lecturer_id\`) REFERENCES \`tt_lecturers\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` ADD CONSTRAINT \`FK_939bfce5371a01fe7b79c08daa9\` FOREIGN KEY (\`lesson_id\`) REFERENCES \`tt_lessons\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` ADD CONSTRAINT \`FK_e0a9d1aa9ba65bad155a91bccab\` FOREIGN KEY (\`term_id\`) REFERENCES \`tt_terms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` ADD CONSTRAINT \`FK_2f03d3a2c5f61c046edd407d2c9\` FOREIGN KEY (\`start_period_id\`) REFERENCES \`tt_periods\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` ADD CONSTRAINT \`FK_4b23ff8fb0c2e0c20fb54189c29\` FOREIGN KEY (\`room_id\`) REFERENCES \`tt_rooms\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_slots\` ADD CONSTRAINT \`FK_eda120a48bdf26c6cd23be443bb\` FOREIGN KEY (\`term_id\`) REFERENCES \`tt_terms\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_slots\` ADD CONSTRAINT \`FK_576dfdb0ffd77e55ca31c6f84c7\` FOREIGN KEY (\`session_id\`) REFERENCES \`tt_sessions\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_slots\` ADD CONSTRAINT \`FK_db4bcaee576b732eab781c687a6\` FOREIGN KEY (\`period_id\`) REFERENCES \`tt_periods\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lesson_classes\` ADD CONSTRAINT \`FK_944a929bc9430fea8a044098282\` FOREIGN KEY (\`lesson_id\`) REFERENCES \`tt_lessons\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lesson_classes\` ADD CONSTRAINT \`FK_a602706734306d7d6008249b9ed\` FOREIGN KEY (\`class_id\`) REFERENCES \`tt_classes\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tt_lesson_classes\` DROP FOREIGN KEY \`FK_a602706734306d7d6008249b9ed\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lesson_classes\` DROP FOREIGN KEY \`FK_944a929bc9430fea8a044098282\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_slots\` DROP FOREIGN KEY \`FK_db4bcaee576b732eab781c687a6\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_slots\` DROP FOREIGN KEY \`FK_576dfdb0ffd77e55ca31c6f84c7\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_slots\` DROP FOREIGN KEY \`FK_eda120a48bdf26c6cd23be443bb\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` DROP FOREIGN KEY \`FK_4b23ff8fb0c2e0c20fb54189c29\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` DROP FOREIGN KEY \`FK_2f03d3a2c5f61c046edd407d2c9\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` DROP FOREIGN KEY \`FK_e0a9d1aa9ba65bad155a91bccab\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_sessions\` DROP FOREIGN KEY \`FK_939bfce5371a01fe7b79c08daa9\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lessons\` DROP FOREIGN KEY \`FK_6b9e1b88c56d20f380b24014a5d\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lessons\` DROP FOREIGN KEY \`FK_cf9306d17c6ee4c3ba4002bd116\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_lessons\` DROP FOREIGN KEY \`FK_a96acae6873c5a04968cff2fcd4\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_periods\` DROP FOREIGN KEY \`FK_9e8ebca4d5185c1985b7071876d\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`tt_classes\` DROP FOREIGN KEY \`FK_932b43b3d9ce52b8a1f2fac5bdc\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_a602706734306d7d6008249b9e\` ON \`tt_lesson_classes\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_944a929bc9430fea8a04409828\` ON \`tt_lesson_classes\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_lesson_classes\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_656de59dca2c8c3f344c343534\` ON \`tt_slots\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_slots\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_40b84b3a52225706a4c98709d7\` ON \`tt_sessions\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_sessions\``);
    await queryRunner.query(`DROP TABLE \`tt_lessons\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_0b32ed2388b6b2ee20a516a568\` ON \`tt_periods\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_periods\``);
    await queryRunner.query(`DROP TABLE \`tt_terms\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_51c44dcb08ad0e1d38c59ac5ba\` ON \`tt_units\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_units\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_fdd0e87958c0d8122865a7c32d\` ON \`tt_classes\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_classes\``);
    await queryRunner.query(`DROP TABLE \`tt_lecturers\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_ae7198bc494bf82b157cbda403\` ON \`tt_rooms\``,
    );
    await queryRunner.query(`DROP TABLE \`tt_rooms\``);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class Admissions1790842705223 implements MigrationInterface {
  name = 'Admissions1790842705223';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`intakes\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(100) NOT NULL, \`opens_at\` datetime NOT NULL, \`closes_at\` datetime NOT NULL, \`starts_on\` date NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`programmes\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`code\` varchar(30) NOT NULL, \`name\` varchar(200) NOT NULL, \`level\` enum ('certificate', 'diploma', 'degree', 'postgraduate', 'short_course') NOT NULL, \`school\` varchar(150) NOT NULL, \`duration\` varchar(60) NULL, \`study_modes\` json NOT NULL, \`min_mean_grade\` varchar(3) NULL, \`description\` text NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` smallint UNSIGNED NOT NULL DEFAULT '0', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_716cd216ca31adaa70e65bb189\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`applications\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`application_number\` varchar(40) NULL, \`study_mode\` varchar(20) NULL, \`status\` enum ('draft', 'submitted', 'under_review', 'info_requested', 'offered', 'rejected', 'withdrawn') NOT NULL DEFAULT 'draft', \`personal\` json NULL, \`next_of_kin\` json NULL, \`education\` json NULL, \`funding\` json NULL, \`full_name\` varchar(200) NULL, \`phone\` varchar(20) NULL, \`kcse_index_number\` varchar(20) NULL, \`mean_grade\` varchar(3) NULL, \`declaration_accepted_at\` datetime NULL, \`fee_status\` enum ('unpaid', 'claimed', 'verified') NOT NULL DEFAULT 'unpaid', \`fee_reference\` varchar(20) NULL, \`fee_verified_at\` datetime NULL, \`submitted_at\` datetime NULL, \`decided_at\` datetime NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`applicant_id\` int UNSIGNED NOT NULL, \`intake_id\` int UNSIGNED NULL, \`programme_id\` int UNSIGNED NULL, \`fee_verified_by_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_3861f3cbf221d63e0884c014ba\` (\`application_number\`), INDEX \`IDX_8ee114cee92e995a9e75c05cfb\` (\`status\`), INDEX \`IDX_e7f95b336302544444fc4c5585\` (\`full_name\`), INDEX \`IDX_2a0d360795579fb6720dc6450b\` (\`kcse_index_number\`), INDEX \`IDX_1b516a6f99136b90d7288b60fc\` (\`status\`, \`submitted_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`document_types\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`name\` varchar(150) NOT NULL, \`description\` varchar(500) NULL, \`is_required\` tinyint NOT NULL DEFAULT 1, \`accepts\` varchar(10) NOT NULL DEFAULT 'any', \`max_size_mb\` tinyint UNSIGNED NOT NULL DEFAULT '5', \`is_active\` tinyint NOT NULL DEFAULT 1, \`sort_order\` smallint UNSIGNED NOT NULL DEFAULT '0', PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`application_documents\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`original_name\` varchar(255) NOT NULL, \`storage_key\` varchar(191) NOT NULL, \`mime_type\` varchar(100) NOT NULL, \`size_bytes\` int UNSIGNED NOT NULL, \`status\` enum ('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending', \`review_note\` varchar(500) NULL, \`reviewed_at\` datetime NULL, \`uploaded_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`application_id\` int UNSIGNED NOT NULL, \`document_type_id\` int UNSIGNED NOT NULL, \`reviewed_by_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_157ed921b6d45fc70b77abfe8b\` (\`storage_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`application_events\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`type\` varchar(30) NOT NULL, \`from_status\` varchar(20) NULL, \`to_status\` varchar(20) NULL, \`message\` text NULL, \`visible_to_applicant\` tinyint NOT NULL DEFAULT 0, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`application_id\` int UNSIGNED NOT NULL, \`actor_id\` int UNSIGNED NULL, INDEX \`IDX_81ae228585ddb928740f6ba4ba\` (\`application_id\`, \`created_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` ADD CONSTRAINT \`FK_194d0fca275b8661a56e486cb64\` FOREIGN KEY (\`applicant_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` ADD CONSTRAINT \`FK_8f9bfeac57b7b6ba919a40df450\` FOREIGN KEY (\`intake_id\`) REFERENCES \`intakes\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` ADD CONSTRAINT \`FK_5316668b02db8cab0edef397cbe\` FOREIGN KEY (\`programme_id\`) REFERENCES \`programmes\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` ADD CONSTRAINT \`FK_8503b603f126db529ab00fbb706\` FOREIGN KEY (\`fee_verified_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_documents\` ADD CONSTRAINT \`FK_9ad8ab815e842d67e9aaec900cb\` FOREIGN KEY (\`application_id\`) REFERENCES \`applications\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_documents\` ADD CONSTRAINT \`FK_b559d97180e6516974b13e24905\` FOREIGN KEY (\`document_type_id\`) REFERENCES \`document_types\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_documents\` ADD CONSTRAINT \`FK_1546a6654e00ea3bb56113718f0\` FOREIGN KEY (\`reviewed_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_events\` ADD CONSTRAINT \`FK_58159d663fba2a48144c5ed3f4d\` FOREIGN KEY (\`application_id\`) REFERENCES \`applications\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_events\` ADD CONSTRAINT \`FK_606f03dbd6169c562fac2bbe183\` FOREIGN KEY (\`actor_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`application_events\` DROP FOREIGN KEY \`FK_606f03dbd6169c562fac2bbe183\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_events\` DROP FOREIGN KEY \`FK_58159d663fba2a48144c5ed3f4d\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_documents\` DROP FOREIGN KEY \`FK_1546a6654e00ea3bb56113718f0\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_documents\` DROP FOREIGN KEY \`FK_b559d97180e6516974b13e24905\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`application_documents\` DROP FOREIGN KEY \`FK_9ad8ab815e842d67e9aaec900cb\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` DROP FOREIGN KEY \`FK_8503b603f126db529ab00fbb706\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` DROP FOREIGN KEY \`FK_5316668b02db8cab0edef397cbe\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` DROP FOREIGN KEY \`FK_8f9bfeac57b7b6ba919a40df450\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` DROP FOREIGN KEY \`FK_194d0fca275b8661a56e486cb64\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_81ae228585ddb928740f6ba4ba\` ON \`application_events\``,
    );
    await queryRunner.query(`DROP TABLE \`application_events\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_157ed921b6d45fc70b77abfe8b\` ON \`application_documents\``,
    );
    await queryRunner.query(`DROP TABLE \`application_documents\``);
    await queryRunner.query(`DROP TABLE \`document_types\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_1b516a6f99136b90d7288b60fc\` ON \`applications\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_2a0d360795579fb6720dc6450b\` ON \`applications\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_e7f95b336302544444fc4c5585\` ON \`applications\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_8ee114cee92e995a9e75c05cfb\` ON \`applications\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_3861f3cbf221d63e0884c014ba\` ON \`applications\``,
    );
    await queryRunner.query(`DROP TABLE \`applications\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_716cd216ca31adaa70e65bb189\` ON \`programmes\``,
    );
    await queryRunner.query(`DROP TABLE \`programmes\``);
    await queryRunner.query(`DROP TABLE \`intakes\``);
  }
}

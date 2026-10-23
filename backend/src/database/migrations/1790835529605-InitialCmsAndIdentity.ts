import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialCmsAndIdentity1790835529605 implements MigrationInterface {
  name = 'InitialCmsAndIdentity1790835529605';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`media_variants\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`format\` varchar(10) NOT NULL, \`width\` smallint UNSIGNED NOT NULL, \`height\` smallint UNSIGNED NOT NULL, \`storage_key\` varchar(500) NOT NULL, \`size_bytes\` int UNSIGNED NOT NULL, \`media_id\` int UNSIGNED NOT NULL, UNIQUE INDEX \`IDX_54ff2d0de2daf1627b36240ced\` (\`media_id\`, \`width\`, \`format\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`media\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`original_name\` varchar(255) NOT NULL, \`storage_key\` varchar(191) NOT NULL, \`mime_type\` varchar(100) NOT NULL, \`size_bytes\` int UNSIGNED NOT NULL, \`width\` smallint UNSIGNED NULL, \`height\` smallint UNSIGNED NULL, \`alt_text\` varchar(300) NULL, \`caption\` varchar(500) NULL, \`credit\` varchar(200) NULL, \`has_consent\` tinyint NOT NULL DEFAULT 0, \`focal_x\` decimal(4,3) NOT NULL DEFAULT '0.500', \`focal_y\` decimal(4,3) NOT NULL DEFAULT '0.500', \`folder\` varchar(150) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`uploaded_by_id\` int UNSIGNED NULL, INDEX \`IDX_b7b8e2c7f523dba4b76da1abec\` (\`folder\`), UNIQUE INDEX \`IDX_9ba0d5268d6f75eca1b62cf10b\` (\`storage_key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`page_blocks\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`type\` varchar(50) NOT NULL, \`sort_order\` smallint UNSIGNED NOT NULL, \`is_hidden\` tinyint NOT NULL DEFAULT 0, \`content\` json NOT NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`page_id\` int UNSIGNED NOT NULL, INDEX \`IDX_5933e85b49205abfac78e21189\` (\`page_id\`, \`sort_order\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`page_revisions\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`revision_number\` int UNSIGNED NOT NULL, \`snapshot\` json NOT NULL, \`note\` varchar(255) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`page_id\` int UNSIGNED NOT NULL, \`created_by_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_3a8ab0d8038c3cbf6fe8dc2992\` (\`page_id\`, \`revision_number\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`pages\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`title\` varchar(200) NOT NULL, \`slug\` varchar(150) NOT NULL, \`path\` varchar(500) NOT NULL, \`template\` enum ('standard', 'landing', 'full_width', 'side_nav') NOT NULL DEFAULT 'standard', \`status\` enum ('draft', 'in_review', 'published', 'archived') NOT NULL DEFAULT 'draft', \`visibility\` enum ('public', 'applicants', 'students') NOT NULL DEFAULT 'public', \`seo_title\` varchar(200) NULL, \`meta_description\` varchar(300) NULL, \`publish_at\` datetime NULL, \`unpublish_at\` datetime NULL, \`locked_at\` datetime NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deleted_at\` datetime(6) NULL, \`parent_id\` int UNSIGNED NULL, \`social_image_id\` int UNSIGNED NULL, \`published_revision_id\` int UNSIGNED NULL, \`locked_by_id\` int UNSIGNED NULL, \`created_by_id\` int UNSIGNED NULL, \`updated_by_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_f21133f58be5697b550323b8a3\` (\`path\`), INDEX \`IDX_aba05a4338b83bab7a04e0865f\` (\`status\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`permissions\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`key\` varchar(100) NOT NULL, \`description\` varchar(255) NOT NULL, UNIQUE INDEX \`IDX_017943867ed5ceef9c03edd974\` (\`key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`roles\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`key\` varchar(50) NOT NULL, \`name\` varchar(100) NOT NULL, \`description\` varchar(255) NULL, UNIQUE INDEX \`IDX_a87cf0659c3ac379b339acf36a\` (\`key\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`user_roles\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`user_id\` int UNSIGNED NOT NULL, \`role_id\` int UNSIGNED NOT NULL, \`scope_page_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_548616501ef3a4fd99a2702b7a\` (\`user_id\`, \`role_id\`, \`scope_page_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`users\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`email\` varchar(191) NOT NULL, \`phone\` varchar(20) NULL, \`full_name\` varchar(150) NOT NULL, \`password_hash\` varchar(255) NOT NULL, \`status\` enum ('pending', 'active', 'disabled') NOT NULL DEFAULT 'pending', \`two_factor_secret\` varchar(255) NULL, \`last_login_at\` datetime NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`audit_logs\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`action\` varchar(100) NOT NULL, \`entity_type\` varchar(50) NULL, \`entity_id\` varchar(50) NULL, \`details\` json NULL, \`ip_address\` varchar(45) NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`user_id\` int UNSIGNED NULL, INDEX \`IDX_cee5459245f652b75eb2759b4c\` (\`action\`), INDEX \`IDX_2cd10fda8276bb995288acfbfb\` (\`created_at\`), INDEX \`IDX_7421efc125d95e413657efa3c6\` (\`entity_type\`, \`entity_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`media_usage\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`entity_type\` varchar(50) NOT NULL, \`entity_id\` varchar(50) NOT NULL, \`field_path\` varchar(150) NOT NULL, \`media_id\` int UNSIGNED NOT NULL, INDEX \`IDX_fa2864ccca86737395635b2aca\` (\`entity_type\`, \`entity_id\`), UNIQUE INDEX \`IDX_93506d2c5a3005bd112b98df40\` (\`media_id\`, \`entity_type\`, \`entity_id\`, \`field_path\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`menus\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`location\` varchar(50) NOT NULL, \`name\` varchar(100) NOT NULL, UNIQUE INDEX \`IDX_316150396b21bccd568165298f\` (\`location\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`menu_items\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`label\` varchar(100) NOT NULL, \`url\` varchar(500) NULL, \`open_in_new_tab\` tinyint NOT NULL DEFAULT 0, \`is_button\` tinyint NOT NULL DEFAULT 0, \`sort_order\` smallint UNSIGNED NOT NULL DEFAULT '0', \`is_visible\` tinyint NOT NULL DEFAULT 1, \`menu_id\` int UNSIGNED NOT NULL, \`parent_id\` int UNSIGNED NULL, \`page_id\` int UNSIGNED NULL, INDEX \`IDX_b77adf9a19efddca667f318d30\` (\`menu_id\`, \`parent_id\`, \`sort_order\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`redirects\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`from_path\` varchar(191) NOT NULL, \`to_path\` varchar(500) NOT NULL, \`status_code\` smallint UNSIGNED NOT NULL DEFAULT '301', \`hit_count\` int UNSIGNED NOT NULL DEFAULT '0', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_294da5325047f1e02da0a0f59c\` (\`from_path\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`site_settings\` (\`key\` varchar(100) NOT NULL, \`value\` json NOT NULL, \`group_name\` varchar(50) NOT NULL, \`description\` varchar(255) NULL, \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`updated_by_id\` int UNSIGNED NULL, PRIMARY KEY (\`key\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`text_strings\` (\`id\` int UNSIGNED NOT NULL AUTO_INCREMENT, \`key\` varchar(150) NOT NULL, \`locale\` varchar(10) NOT NULL DEFAULT 'en', \`value\` text NOT NULL, \`description\` varchar(255) NULL, \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`updated_by_id\` int UNSIGNED NULL, UNIQUE INDEX \`IDX_d00ea15dcbc721ef6e24c1d4ce\` (\`key\`, \`locale\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`role_permissions\` (\`role_id\` int UNSIGNED NOT NULL, \`permission_id\` int UNSIGNED NOT NULL, INDEX \`IDX_178199805b901ccd220ab7740e\` (\`role_id\`), INDEX \`IDX_17022daf3f885f7d35423e9971\` (\`permission_id\`), PRIMARY KEY (\`role_id\`, \`permission_id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`media_variants\` ADD CONSTRAINT \`FK_753f0f51a9ad2ec1b896c61377e\` FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`media\` ADD CONSTRAINT \`FK_0498a52d4d304aa6810d0772208\` FOREIGN KEY (\`uploaded_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_blocks\` ADD CONSTRAINT \`FK_ad019765c7ffab9084d1d215d48\` FOREIGN KEY (\`page_id\`) REFERENCES \`pages\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_revisions\` ADD CONSTRAINT \`FK_bb569d1c07aac2ea57cf7a62090\` FOREIGN KEY (\`page_id\`) REFERENCES \`pages\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_revisions\` ADD CONSTRAINT \`FK_a6478166d4779e0aac30f057a10\` FOREIGN KEY (\`created_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` ADD CONSTRAINT \`FK_65fc17f66b9d5e426eaf942dc86\` FOREIGN KEY (\`parent_id\`) REFERENCES \`pages\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` ADD CONSTRAINT \`FK_7c57056d13201be748a87a8e6fe\` FOREIGN KEY (\`social_image_id\`) REFERENCES \`media\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` ADD CONSTRAINT \`FK_f8d27ab7b1c4fff980f3ccf983e\` FOREIGN KEY (\`published_revision_id\`) REFERENCES \`page_revisions\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` ADD CONSTRAINT \`FK_606be2ed5e5538387bf581170ef\` FOREIGN KEY (\`locked_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` ADD CONSTRAINT \`FK_013b1eaf7f474ea4a78b827f445\` FOREIGN KEY (\`created_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` ADD CONSTRAINT \`FK_45399fad693a2f3aec4280e6aba\` FOREIGN KEY (\`updated_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_87b8888186ca9769c960e926870\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_b23c65e50a758245a33ee35fda1\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_352f824d584dc053e556e915fd2\` FOREIGN KEY (\`scope_page_id\`) REFERENCES \`pages\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` ADD CONSTRAINT \`FK_bd2726fd31b35443f2245b93ba0\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`media_usage\` ADD CONSTRAINT \`FK_b8ec1a6d44a141bb1fd35918fa8\` FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` ADD CONSTRAINT \`FK_ba71edc684a901b4bc9d9228f42\` FOREIGN KEY (\`menu_id\`) REFERENCES \`menus\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` ADD CONSTRAINT \`FK_8e20ca40202c116fdafe92cdc4e\` FOREIGN KEY (\`parent_id\`) REFERENCES \`menu_items\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` ADD CONSTRAINT \`FK_d15d1b5421f983c49390a68d4f9\` FOREIGN KEY (\`page_id\`) REFERENCES \`pages\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` ADD CONSTRAINT \`FK_e9c2cb57815c5a30778fa5e2712\` FOREIGN KEY (\`updated_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`text_strings\` ADD CONSTRAINT \`FK_92cdefbfa65f241f8a21266feca\` FOREIGN KEY (\`updated_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`role_permissions\` ADD CONSTRAINT \`FK_178199805b901ccd220ab7740ec\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE \`role_permissions\` ADD CONSTRAINT \`FK_17022daf3f885f7d35423e9971e\` FOREIGN KEY (\`permission_id\`) REFERENCES \`permissions\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`role_permissions\` DROP FOREIGN KEY \`FK_17022daf3f885f7d35423e9971e\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`role_permissions\` DROP FOREIGN KEY \`FK_178199805b901ccd220ab7740ec\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`text_strings\` DROP FOREIGN KEY \`FK_92cdefbfa65f241f8a21266feca\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`site_settings\` DROP FOREIGN KEY \`FK_e9c2cb57815c5a30778fa5e2712\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` DROP FOREIGN KEY \`FK_d15d1b5421f983c49390a68d4f9\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` DROP FOREIGN KEY \`FK_8e20ca40202c116fdafe92cdc4e\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`menu_items\` DROP FOREIGN KEY \`FK_ba71edc684a901b4bc9d9228f42\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`media_usage\` DROP FOREIGN KEY \`FK_b8ec1a6d44a141bb1fd35918fa8\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`audit_logs\` DROP FOREIGN KEY \`FK_bd2726fd31b35443f2245b93ba0\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_352f824d584dc053e556e915fd2\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_b23c65e50a758245a33ee35fda1\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_87b8888186ca9769c960e926870\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` DROP FOREIGN KEY \`FK_45399fad693a2f3aec4280e6aba\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` DROP FOREIGN KEY \`FK_013b1eaf7f474ea4a78b827f445\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` DROP FOREIGN KEY \`FK_606be2ed5e5538387bf581170ef\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` DROP FOREIGN KEY \`FK_f8d27ab7b1c4fff980f3ccf983e\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` DROP FOREIGN KEY \`FK_7c57056d13201be748a87a8e6fe\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`pages\` DROP FOREIGN KEY \`FK_65fc17f66b9d5e426eaf942dc86\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_revisions\` DROP FOREIGN KEY \`FK_a6478166d4779e0aac30f057a10\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_revisions\` DROP FOREIGN KEY \`FK_bb569d1c07aac2ea57cf7a62090\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`page_blocks\` DROP FOREIGN KEY \`FK_ad019765c7ffab9084d1d215d48\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`media\` DROP FOREIGN KEY \`FK_0498a52d4d304aa6810d0772208\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`media_variants\` DROP FOREIGN KEY \`FK_753f0f51a9ad2ec1b896c61377e\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_17022daf3f885f7d35423e9971\` ON \`role_permissions\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_178199805b901ccd220ab7740e\` ON \`role_permissions\``,
    );
    await queryRunner.query(`DROP TABLE \`role_permissions\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_d00ea15dcbc721ef6e24c1d4ce\` ON \`text_strings\``,
    );
    await queryRunner.query(`DROP TABLE \`text_strings\``);
    await queryRunner.query(`DROP TABLE \`site_settings\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_294da5325047f1e02da0a0f59c\` ON \`redirects\``,
    );
    await queryRunner.query(`DROP TABLE \`redirects\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_b77adf9a19efddca667f318d30\` ON \`menu_items\``,
    );
    await queryRunner.query(`DROP TABLE \`menu_items\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_316150396b21bccd568165298f\` ON \`menus\``,
    );
    await queryRunner.query(`DROP TABLE \`menus\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_93506d2c5a3005bd112b98df40\` ON \`media_usage\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_fa2864ccca86737395635b2aca\` ON \`media_usage\``,
    );
    await queryRunner.query(`DROP TABLE \`media_usage\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_7421efc125d95e413657efa3c6\` ON \`audit_logs\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_2cd10fda8276bb995288acfbfb\` ON \`audit_logs\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_cee5459245f652b75eb2759b4c\` ON \`audit_logs\``,
    );
    await queryRunner.query(`DROP TABLE \`audit_logs\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``,
    );
    await queryRunner.query(`DROP TABLE \`users\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_548616501ef3a4fd99a2702b7a\` ON \`user_roles\``,
    );
    await queryRunner.query(`DROP TABLE \`user_roles\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_a87cf0659c3ac379b339acf36a\` ON \`roles\``,
    );
    await queryRunner.query(`DROP TABLE \`roles\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_017943867ed5ceef9c03edd974\` ON \`permissions\``,
    );
    await queryRunner.query(`DROP TABLE \`permissions\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_aba05a4338b83bab7a04e0865f\` ON \`pages\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_f21133f58be5697b550323b8a3\` ON \`pages\``,
    );
    await queryRunner.query(`DROP TABLE \`pages\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_3a8ab0d8038c3cbf6fe8dc2992\` ON \`page_revisions\``,
    );
    await queryRunner.query(`DROP TABLE \`page_revisions\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_5933e85b49205abfac78e21189\` ON \`page_blocks\``,
    );
    await queryRunner.query(`DROP TABLE \`page_blocks\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_9ba0d5268d6f75eca1b62cf10b\` ON \`media\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_b7b8e2c7f523dba4b76da1abec\` ON \`media\``,
    );
    await queryRunner.query(`DROP TABLE \`media\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_54ff2d0de2daf1627b36240ced\` ON \`media_variants\``,
    );
    await queryRunner.query(`DROP TABLE \`media_variants\``);
  }
}

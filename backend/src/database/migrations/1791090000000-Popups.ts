import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Website pop-ups made in Admin → Pop-ups (events, offers, new courses, news). */
export class Popups1791090000000 implements MigrationInterface {
  name = 'Popups1791090000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`popups\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`kind\` varchar(20) NOT NULL DEFAULT 'announcement',
        \`label\` varchar(60) NULL,
        \`title\` varchar(120) NOT NULL,
        \`details\` text NOT NULL,
        \`image_id\` int UNSIGNED NULL,
        \`event_at\` datetime NULL,
        \`button_label\` varchar(40) NULL,
        \`button_link\` varchar(500) NULL,
        \`starts_at\` datetime NULL,
        \`ends_at\` datetime NULL,
        \`is_active\` tinyint NOT NULL DEFAULT 1,
        \`sort_order\` int NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_popups_active\` (\`is_active\`, \`sort_order\`)
      ) ENGINE=InnoDB`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `popups`');
  }
}

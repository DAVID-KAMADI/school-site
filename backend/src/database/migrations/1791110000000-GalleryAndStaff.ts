import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The website's Gallery page (photo albums) and Our people page (the institute's staff hierarchy),
 * both edited in the admin portal. Also the editable heading and intro of each page.
 */
export class GalleryAndStaff1791110000000 implements MigrationInterface {
  name = 'GalleryAndStaff1791110000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`gallery_albums\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`title\` varchar(120) NOT NULL,
        \`slug\` varchar(140) NOT NULL,
        \`description\` varchar(1000) NULL,
        \`category\` varchar(60) NULL,
        \`cover_image_id\` int UNSIGNED NULL,
        \`taken_on\` date NULL,
        \`is_published\` tinyint NOT NULL DEFAULT 1,
        \`is_featured\` tinyint NOT NULL DEFAULT 0,
        \`sort_order\` int NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_gallery_albums_slug\` (\`slug\`),
        INDEX \`IDX_gallery_albums_published\` (\`is_published\`, \`sort_order\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`gallery_photos\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`album_id\` int UNSIGNED NOT NULL,
        \`media_id\` int UNSIGNED NOT NULL,
        \`caption\` varchar(300) NULL,
        \`sort_order\` int NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_gallery_photos_album\` (\`album_id\`, \`sort_order\`),
        CONSTRAINT \`FK_gallery_photos_album\` FOREIGN KEY (\`album_id\`) REFERENCES \`gallery_albums\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`staff_levels\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` varchar(80) NOT NULL,
        \`description\` varchar(300) NULL,
        \`sort_order\` int NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`staff_members\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`level_id\` int UNSIGNED NOT NULL,
        \`name\` varchar(120) NOT NULL,
        \`position\` varchar(120) NOT NULL,
        \`department\` varchar(120) NULL,
        \`photo_id\` int UNSIGNED NULL,
        \`bio\` text NULL,
        \`email\` varchar(160) NULL,
        \`phone\` varchar(40) NULL,
        \`is_published\` tinyint NOT NULL DEFAULT 1,
        \`sort_order\` int NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_staff_members_level\` (\`level_id\`, \`sort_order\`),
        CONSTRAINT \`FK_staff_members_level\` FOREIGN KEY (\`level_id\`) REFERENCES \`staff_levels\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB`,
    );

    // Starting tiers, top first. Renamed, removed or added to in Admin → Staff hierarchy.
    const levels: [string, string | null][] = [
      [
        'Board of Governors',
        'Sets the direction of the institute and oversees its work.',
      ],
      ["Principal's office", 'Leads the institute day to day.'],
      ['Heads of department', 'Lead each course area and office.'],
      ['Lecturers & trainers', null],
      ['Administration & support', null],
    ];
    for (const [i, [name, description]] of levels.entries())
      await q.query(
        'INSERT INTO `staff_levels` (`name`, `description`, `sort_order`) VALUES (?, ?, ?)',
        [name, description, i],
      );

    const pages: [string, string, object][] = [
      [
        'gallery.page',
        'Heading and introduction of the Gallery page (/gallery).',
        {
          eyebrow: 'Life at the institute',
          title: 'Gallery',
          intro:
            'Moments from our classrooms, labs, field work, graduations and events.',
        },
      ],
      [
        'staff.page',
        'Heading and introduction of the Our people page (/staff).',
        {
          eyebrow: 'Who we are',
          title: 'Our people',
          intro:
            'Meet the leadership, lecturers and staff who run the institute and support every student.',
        },
      ],
    ];
    for (const [key, description, value] of pages)
      await q.query(
        'INSERT IGNORE INTO `site_settings` (`key`, `value`, `group_name`, `description`) VALUES (?, ?, ?, ?)',
        [key, JSON.stringify(value), 'showcase', description],
      );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE FROM `site_settings` WHERE `key` IN ('gallery.page', 'staff.page')",
    );
    await q.query('DROP TABLE `staff_members`');
    await q.query('DROP TABLE `staff_levels`');
    await q.query('DROP TABLE `gallery_photos`');
    await q.query('DROP TABLE `gallery_albums`');
  }
}

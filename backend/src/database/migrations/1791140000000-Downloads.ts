import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The website's Downloads page (/downloads): tenders, job vacancies, forms and other documents,
 * grouped in categories, edited in Admin → Downloads.
 */
export class Downloads1791140000000 implements MigrationInterface {
  name = 'Downloads1791140000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`download_categories\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` varchar(80) NOT NULL,
        \`slug\` varchar(90) NOT NULL,
        \`description\` varchar(300) NULL,
        \`sort_order\` int NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_download_categories_slug\` (\`slug\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`downloads\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`category_id\` int UNSIGNED NOT NULL,
        \`title\` varchar(200) NOT NULL,
        \`reference\` varchar(80) NULL,
        \`summary\` varchar(1000) NULL,
        \`media_id\` int UNSIGNED NOT NULL,
        \`published_on\` date NOT NULL,
        \`closes_at\` datetime NULL,
        \`is_published\` tinyint NOT NULL DEFAULT 1,
        \`is_pinned\` tinyint NOT NULL DEFAULT 0,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_downloads_category\` (\`category_id\`, \`is_published\`),
        CONSTRAINT \`FK_downloads_category\` FOREIGN KEY (\`category_id\`) REFERENCES \`download_categories\` (\`id\`) ON DELETE RESTRICT
      ) ENGINE=InnoDB`,
    );

    // Starting categories. Renamed, removed or added to in Admin → Downloads.
    const categories: [string, string, string | null][] = [
      ['Tenders', 'tenders', 'Open tenders and requests for quotation. Read the documents and submit before the closing date.'],
      ['Job vacancies', 'jobs', 'Current job openings at the institute and how to apply.'],
      ['Forms', 'forms', 'Forms for students, parents and visitors.'],
      ['Reports & publications', 'reports', 'Annual reports, strategic plans, policies and other publications.'],
      ['Other documents', 'other', null],
    ];
    for (const [i, [name, slug, description]] of categories.entries())
      await q.query(
        'INSERT INTO `download_categories` (`name`, `slug`, `description`, `sort_order`) VALUES (?, ?, ?, ?)',
        [name, slug, description, i],
      );

    await q.query(
      'INSERT IGNORE INTO `site_settings` (`key`, `value`, `group_name`, `description`) VALUES (?, ?, ?, ?)',
      [
        'downloads.page',
        JSON.stringify({
          eyebrow: 'Documents',
          title: 'Downloads',
          intro: 'Tenders, job vacancies, forms and publications from the institute.',
        }),
        'showcase',
        'Heading and introduction of the Downloads page (/downloads).',
      ],
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query("DELETE FROM `site_settings` WHERE `key` = 'downloads.page'");
    await q.query('DROP TABLE `downloads`');
    await q.query('DROP TABLE `download_categories`');
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class Blog1790940000001 implements MigrationInterface {
  name = 'Blog1790940000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`blog_posts\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`title\` varchar(200) NOT NULL,
        \`slug\` varchar(180) NOT NULL,
        \`excerpt\` varchar(500) NOT NULL DEFAULT '',
        \`content\` longtext NOT NULL,
        \`status\` enum ('draft', 'published') NOT NULL DEFAULT 'draft',
        \`published_at\` datetime NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`cover_image_id\` int UNSIGNED NULL,
        \`author_id\` int UNSIGNED NULL,
        UNIQUE INDEX \`IDX_blog_posts_slug\` (\`slug\`),
        INDEX \`IDX_blog_posts_status_published_at\` (\`status\`, \`published_at\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_blog_posts_cover_image\` FOREIGN KEY (\`cover_image_id\`) REFERENCES \`media\`(\`id\`) ON DELETE SET NULL,
        CONSTRAINT \`FK_blog_posts_author\` FOREIGN KEY (\`author_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `blog_posts`');
  }
}

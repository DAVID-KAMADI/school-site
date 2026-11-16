import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Log of every SMS and email sent (applicant follow-ups and test messages). */
export class MessageLog1791080000000 implements MigrationInterface {
  name = 'MessageLog1791080000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`message_log\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`channel\` varchar(10) NOT NULL,
        \`purpose\` varchar(20) NOT NULL,
        \`recipient\` varchar(200) NOT NULL,
        \`subject\` varchar(200) NULL,
        \`body\` text NOT NULL,
        \`status\` varchar(10) NOT NULL,
        \`provider_message_id\` varchar(120) NULL,
        \`provider_status\` varchar(60) NULL,
        \`cost\` varchar(30) NULL,
        \`error\` varchar(500) NULL,
        \`recipient_user_id\` int UNSIGNED NULL,
        \`application_id\` int UNSIGNED NULL,
        \`sent_by_id\` int UNSIGNED NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_message_log_user_created\` (\`recipient_user_id\`, \`created_at\`),
        INDEX \`IDX_message_log_created\` (\`created_at\`),
        CONSTRAINT \`FK_message_log_user\` FOREIGN KEY (\`recipient_user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT \`FK_message_log_application\` FOREIGN KEY (\`application_id\`) REFERENCES \`applications\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT \`FK_message_log_sent_by\` FOREIGN KEY (\`sent_by_id\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION
      ) ENGINE=InnoDB`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE `message_log`');
  }
}

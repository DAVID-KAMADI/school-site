import { MigrationInterface, QueryRunner } from 'typeorm';

export class OfferResponses1790859948535 implements MigrationInterface {
  name = 'OfferResponses1790859948535';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`applications\` ADD \`responded_at\` datetime NULL`,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_1b516a6f99136b90d7288b60fc\` ON \`applications\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` CHANGE \`status\` \`status\` enum ('draft', 'submitted', 'under_review', 'info_requested', 'offered', 'rejected', 'withdrawn', 'accepted', 'declined') NOT NULL DEFAULT 'draft'`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_1b516a6f99136b90d7288b60fc\` ON \`applications\` (\`status\`, \`submitted_at\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_1b516a6f99136b90d7288b60fc\` ON \`applications\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` CHANGE \`status\` \`status\` enum ('draft', 'submitted', 'under_review', 'info_requested', 'offered', 'rejected', 'withdrawn') NOT NULL DEFAULT 'draft'`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_1b516a6f99136b90d7288b60fc\` ON \`applications\` (\`status\`, \`submitted_at\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`applications\` DROP COLUMN \`responded_at\``,
    );
  }
}

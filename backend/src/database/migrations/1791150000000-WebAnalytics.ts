import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Web analytics (Admin → Web analytics): visitors, sessions, page views, events, goals and conversions,
 * the settings, two permissions and the starting goals.
 */
export class WebAnalytics1791150000000 implements MigrationInterface {
  name = 'WebAnalytics1791150000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE \`analytics_visitors\` (
        \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
        \`visitor_key\` char(32) NOT NULL,
        \`first_seen_at\` datetime NOT NULL,
        \`last_seen_at\` datetime NOT NULL,
        \`sessions\` int UNSIGNED NOT NULL DEFAULT 0,
        UNIQUE INDEX \`IDX_analytics_visitors_visitor_key\` (\`visitor_key\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`analytics_sessions\` (
        \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
        \`visitor_hash\` char(16) NOT NULL,
        \`visitor_id\` bigint UNSIGNED NULL,
        \`is_returning\` tinyint NULL,
        \`started_at\` datetime NOT NULL,
        \`last_seen_at\` datetime NOT NULL,
        \`page_views\` int UNSIGNED NOT NULL DEFAULT 0,
        \`events\` int UNSIGNED NOT NULL DEFAULT 0,
        \`engaged_ms\` int UNSIGNED NOT NULL DEFAULT 0,
        \`is_engaged\` tinyint NOT NULL DEFAULT 0,
        \`conversions\` int UNSIGNED NOT NULL DEFAULT 0,
        \`entry_path\` varchar(300) NOT NULL,
        \`exit_path\` varchar(300) NOT NULL,
        \`referrer_host\` varchar(120) NULL,
        \`channel\` enum ('direct', 'organic', 'social', 'referral', 'email', 'paid', 'other') NOT NULL,
        \`utm_source\` varchar(100) NULL,
        \`utm_medium\` varchar(100) NULL,
        \`utm_campaign\` varchar(150) NULL,
        \`utm_term\` varchar(150) NULL,
        \`utm_content\` varchar(150) NULL,
        \`country\` char(2) NULL,
        \`region\` varchar(80) NULL,
        \`city\` varchar(80) NULL,
        \`device\` enum ('desktop', 'mobile', 'tablet') NOT NULL,
        \`browser\` varchar(30) NOT NULL,
        \`os\` varchar(30) NOT NULL,
        \`screen\` enum ('small', 'medium', 'large', 'xlarge') NULL,
        INDEX \`IDX_analytics_sessions_started\` (\`started_at\`),
        INDEX \`IDX_analytics_sessions_visitor_hash\` (\`visitor_hash\`, \`last_seen_at\`),
        INDEX \`IDX_analytics_sessions_last_seen\` (\`last_seen_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`analytics_page_views\` (
        \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
        \`session_id\` bigint UNSIGNED NOT NULL,
        \`path\` varchar(300) NOT NULL,
        \`title\` varchar(200) NULL,
        \`viewed_at\` datetime NOT NULL,
        \`engaged_ms\` int UNSIGNED NOT NULL DEFAULT 0,
        \`is_entry\` tinyint NOT NULL DEFAULT 0,
        INDEX \`IDX_analytics_page_views_viewed\` (\`viewed_at\`),
        INDEX \`IDX_analytics_page_views_session\` (\`session_id\`),
        INDEX \`IDX_analytics_page_views_path\` (\`path\`, \`viewed_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`analytics_events\` (
        \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
        \`session_id\` bigint UNSIGNED NOT NULL,
        \`client_id\` char(16) NULL,
        \`name\` varchar(60) NOT NULL,
        \`category\` varchar(40) NOT NULL,
        \`label\` varchar(200) NULL,
        \`path\` varchar(300) NOT NULL,
        \`occurred_at\` datetime NOT NULL,
        UNIQUE INDEX \`IDX_analytics_events_client_id\` (\`client_id\`),
        INDEX \`IDX_analytics_events_occurred\` (\`occurred_at\`),
        INDEX \`IDX_analytics_events_name\` (\`name\`, \`occurred_at\`),
        INDEX \`IDX_analytics_events_session\` (\`session_id\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`analytics_goals\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`name\` varchar(80) NOT NULL,
        \`event_name\` varchar(60) NOT NULL,
        \`label_contains\` varchar(120) NULL,
        \`is_active\` tinyint NOT NULL DEFAULT 1,
        \`sort_order\` int NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );
    await q.query(
      `CREATE TABLE \`analytics_conversions\` (
        \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
        \`goal_id\` int UNSIGNED NOT NULL,
        \`session_id\` bigint UNSIGNED NOT NULL,
        \`path\` varchar(300) NOT NULL,
        \`occurred_at\` datetime NOT NULL,
        UNIQUE INDEX \`UQ_analytics_conversions_goal_session\` (\`goal_id\`, \`session_id\`),
        INDEX \`IDX_analytics_conversions_occurred\` (\`occurred_at\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`,
    );

    const goals: [string, string][] = [
      ['Application submitted', 'application_submitted'],
      ['Applicant account created', 'sign_up'],
      ['Document downloaded', 'file_download'],
      ['Contact link clicked', 'contact_click'],
    ];
    for (const [i, [name, event]] of goals.entries())
      await q.query('INSERT INTO `analytics_goals` (`name`, `event_name`, `sort_order`) VALUES (?, ?, ?)', [name, event, i]);

    await q.query(
      'INSERT IGNORE INTO `site_settings` (`key`, `value`, `group_name`, `description`) VALUES (?, ?, ?, ?)',
      [
        'analytics.settings',
        JSON.stringify({
          enabled: true,
          respectDoNotTrack: true,
          retentionMonths: 13,
          excludeStaff: true,
          excludedIps: [],
          customEvents: [],
          funnels: [
            {
              name: 'Application journey',
              steps: [
                { type: 'page', value: '/apply', label: 'Opened the apply page' },
                { type: 'event', value: 'sign_up', label: 'Created an account' },
                { type: 'event', value: 'application_submitted', label: 'Submitted an application' },
              ],
            },
          ],
        }),
        'analytics',
        'Web analytics settings (Admin → Web analytics → Settings).',
      ],
    );

    for (const [key, description, order] of [
      ['analytics.view', 'See website traffic and analytics reports', 44],
      ['analytics.manage', 'Change analytics settings, goals and funnels', 45],
    ] as const)
      await q.query(
        "INSERT INTO `permissions` (`key`, `description`, `module`, `sort_order`) VALUES (?, ?, 'Website analytics', ?)",
        [key, description, order],
      );
    await q.query(
      "INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`) SELECT r.id, p.id FROM `roles` r JOIN `permissions` p ON p.`key` IN ('analytics.view', 'analytics.manage') WHERE r.`key` = 'super_admin'",
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DELETE rp FROM `role_permissions` rp JOIN `permissions` p ON p.id = rp.permission_id WHERE p.`key` IN ('analytics.view', 'analytics.manage')",
    );
    await q.query("DELETE FROM `permissions` WHERE `key` IN ('analytics.view', 'analytics.manage')");
    await q.query("DELETE FROM `site_settings` WHERE `key` = 'analytics.settings'");
    for (const table of ['analytics_conversions', 'analytics_goals', 'analytics_events', 'analytics_page_views', 'analytics_sessions', 'analytics_visitors'])
      await q.query(`DROP TABLE \`${table}\``);
  }
}

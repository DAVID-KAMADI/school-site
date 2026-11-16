/**
 * One-off update of the live Privacy Policy (added with the cookie notice, Nov 2026): replaces
 * section 9 "Cookies" and the Backups retention line with the current text from legal-content.ts,
 * then publishes it as a new revision (shown in the page's history, and reversible there).
 *
 *   npm run legal:cookies
 *
 * Changes nothing if the page has unpublished edits, or if section 9 is missing or already updated.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { PagesService } from '../cms/pages/pages.service.js';
import type { AuthUser } from '../identity/auth-user.js';
import { privacyPolicy } from './legal-content.js';

const SYSTEM_EMAIL = 'website-system@system.local';
const START = '<h2>9. Cookies</h2>';
/** Section 9 ends where this paragraph (kept as it is) begins. */
const END = '<p>If you close a notice banner';
const OLD_BACKUPS = /<tr><td>Backups<\/td><td>Replaced on a rolling basis \(about \[?14\]? days\)<\/td><\/tr>/;

function section(html: string) {
  const from = html.indexOf(START);
  const to = from >= 0 ? html.indexOf(END, from) : -1;
  return from >= 0 && to > from ? { from, to, text: html.slice(from, to) } : null;
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const ds = app.get(DataSource);
  const pages = app.get(PagesService);
  const [system] = (await ds.query('SELECT id FROM users WHERE email = ?', [SYSTEM_EMAIL])) as { id: number }[];
  const [page] = (await ds.query("SELECT id FROM pages WHERE path = '/privacy-policy' AND deleted_at IS NULL")) as {
    id: number;
  }[];
  if (!system || !page) throw new Error('No /privacy-policy page (or system account): run npm run seed:legal first.');
  const actor: AuthUser = {
    id: Number(system.id),
    email: SYSTEM_EMAIL,
    fullName: 'Website system',
    roles: ['super_admin'],
    permissions: ['admin.access', 'pages.edit', 'pages.publish'],
    scopedPermissions: [],
    twoFactorEnabled: true,
  };

  const detail = await pages.detail(Number(page.id), actor);
  if (detail.hasUnpublishedChanges)
    throw new Error('The Privacy Policy has unpublished edits. Publish or discard them in the admin, then run this again.');

  const fresh = section(privacyPolicy({ name: '', short: '', address: '', email: '', phone: '', version: '', updated: '' }))!;
  let changed = false;
  const blocks = detail.blocks.map((b) => {
    const content = b.content as { html?: string };
    if (b.type !== 'rich_text' || typeof content.html !== 'string') return b;
    let html = content.html;
    const old = section(html);
    if (old && !old.text.includes('cookie_consent')) {
      html = html.slice(0, old.from) + fresh.text + html.slice(old.to);
      changed = true;
    }
    if (OLD_BACKUPS.test(html)) {
      html = html.replace(
        OLD_BACKUPS,
        '<tr><td>Backups</td><td>Replaced on a rolling basis: daily copies for about [14] days and weekly copies for about [8] weeks</td></tr>',
      );
      changed = true;
    }
    return { ...b, content: { ...content, html } };
  });
  if (!changed) {
    console.log('Nothing to change: section 9 is already up to date (or was not found).');
  } else {
    await pages.saveContent(
      detail.id,
      {
        title: detail.title,
        template: detail.template,
        seoTitle: detail.seoTitle,
        metaDescription: detail.metaDescription,
        socialImageId: detail.socialImageId,
        blocks: blocks.map((b) => ({ type: b.type, isHidden: b.isHidden, content: b.content })),
        note: 'Cookies section updated for the cookie notice',
      },
      actor,
    );
    await pages.publish(detail.id, actor);
    console.log('Privacy Policy updated and published (section 9 Cookies, Backups retention).');
    console.log('Translations of the page, if any, still need the same change in the admin.');
  }
} finally {
  await app.close();
}

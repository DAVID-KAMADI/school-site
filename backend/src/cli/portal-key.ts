/**
 * Creates a staff sign-in link from the command line. Use it for the very first link (nobody can
 * reach the sign-in page before one exists) or if every administrator is locked out.
 *
 *   npm run portal-key -- --email admin@example.ac.ke --days 30
 *   npm run portal-key -- --name "New lecturers" --days 7 --uses 5
 *
 * With --email the link is personal to that staff member. The link is printed once; only an HMAC
 * of its token is stored, so it cannot be shown again.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module.js';
import { PortalAccessService } from '../identity/portal-access.service.js';
import { UsersService } from '../identity/users.service.js';

const { values } = parseArgs({
  options: {
    name: { type: 'string', default: 'Command-line key' },
    days: { type: 'string', default: '7' },
    uses: { type: 'string', default: '1' },
    email: { type: 'string' },
  },
});

// On Windows, npm passes quoted arguments through cmd.exe, which can leave "^" escape characters behind.
const email = values.email?.replace(/\^/g, '').trim().toLowerCase();
const name =
  (values.name ?? '').replace(/\^/g, '').trim().slice(0, 120) ||
  'Command-line key';
const days = Number(values.days);
const uses = Number(values.uses);
if (!Number.isInteger(days) || days < 1 || days > 365 || !Number.isInteger(uses) || uses < 1 || uses > 500) {
  console.error('Usage: npm run portal-key -- [--email <staff email>] [--name "<purpose>"] --days <1-365> [--uses <1-500>]');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  let userId: number | null = null;
  if (email) {
    const user = await app.get(UsersService).findByEmailWithSecrets(email);
    if (!user) {
      console.error(`No account with the email ${email}.`);
      process.exitCode = 1;
      throw new Error('stop');
    }
    userId = user.id;
  }
  const { key, record } = await app.get(PortalAccessService).create(
    {
      name: email && values.name === 'Command-line key' ? `Sign-in link for ${email}` : name,
      expiresAt: new Date(Date.now() + days * 86_400_000),
      maxUses: uses,
      userId,
    },
    null,
    { ip: null, userAgent: 'command line' },
  );
  const site = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:4300')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');
  console.log('\nStaff sign-in link created. It is shown only once:\n');
  console.log(`  ${site}/admin/${key}\n`);
  console.log(`  Name:     ${record.name}`);
  console.log(
    `  For:      ${email ?? `up to ${record.maxUses} staff member(s), whoever signs in first`}`,
  );
  console.log(`  Expires:  ${record.expiresAt.toISOString()}`);
  console.log(
    '\nOpen the link, then sign in as usual. Bookmark it: /admin without it shows "page not found".\n',
  );
} catch (e) {
  if (!(e instanceof Error && e.message === 'stop')) throw e;
} finally {
  await app.close();
}

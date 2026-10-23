/**
 * Creates a super administrator (or resets an existing user's password and makes them one).
 *
 *   npm run create-admin -- --email you@example.ac.ke --name "Your Name"
 *   npm run create-admin -- --email you@example.ac.ke --reset-password
 *
 * A strong password is generated and printed once. Change it after first sign-in.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module.js';
import { UsersService } from '../identity/users.service.js';

const { values: raw } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'reset-password': { type: 'boolean', default: false },
  },
});

// On Windows, npm passes quoted arguments through cmd.exe, which can leave "^" escape characters behind.
const clean = (v: string | undefined) => v?.replace(/\^/g, '').trim();
const values = { ...raw, email: clean(raw.email), name: clean(raw.name) };

if (!values.email) {
  console.error(
    'Usage: npm run create-admin -- --email <email> --name "<full name>" [--reset-password]',
  );
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const users = app.get(UsersService);
  const password = users.generatePassword();
  const existing = await users.findByEmailWithSecrets(values.email);

  if (existing && !values['reset-password']) {
    console.error(
      `A user with ${values.email} already exists. Add --reset-password to reset it.`,
    );
    process.exitCode = 1;
  } else {
    const userId = existing
      ? (await users.setPassword(existing.id, password), existing.id)
      : (
          await users.create({
            email: values.email,
            fullName: values.name ?? values.email,
            password,
          })
        ).id;
    await users.setRoles(userId, [{ roleKey: 'super_admin' }]);
    console.log('\nSuper administrator ready.');
    console.log(`  Email:    ${values.email}`);
    console.log(`  Password: ${password}`);
    console.log(
      '\nThis password is shown only once. You will be asked to set up two-step login when you sign in.\n',
    );
  }
} finally {
  await app.close();
}

/**
 * With NODE_ENV=production the API refuses to start on unsafe settings,
 * so a training .env can never quietly go live. Warnings are printed but do not stop it.
 */
const isFalse = (v: string | undefined) =>
  ['0', 'false', 'no'].includes((v ?? '').toLowerCase());

export function productionCheck(env: NodeJS.ProcessEnv = process.env): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };

  if (isFalse(env.COOKIE_SECURE))
    errors.push(
      'COOKIE_SECURE must not be false (sign-in cookies would travel over plain HTTP).',
    );
  if (isFalse(env.REQUIRE_STAFF_2FA))
    errors.push('REQUIRE_STAFF_2FA must not be false.');

  const totp = env.TOTP_ENCRYPTION_KEY ?? '';
  if (Buffer.from(totp, 'base64').length !== 32)
    errors.push('TOTP_ENCRYPTION_KEY must be 32 random bytes, base64 encoded.');
  if ((env.PREVIEW_LINK_SECRET ?? '').length < 32)
    errors.push('PREVIEW_LINK_SECRET must be at least 32 characters.');
  if ((env.PORTAL_KEY_SECRET ?? '').length < 32 || env.PORTAL_KEY_SECRET === env.PREVIEW_LINK_SECRET)
    errors.push(
      'PORTAL_KEY_SECRET must be at least 32 random characters, different from PREVIEW_LINK_SECRET.',
    );

  const website = env.WEBSITE_SERVER_SECRET ?? '';
  if (
    website.length < 32 ||
    [env.PREVIEW_LINK_SECRET, env.PORTAL_KEY_SECRET].includes(website)
  )
    errors.push(
      'WEBSITE_SERVER_SECRET must be at least 32 random characters, different from the other secrets, and the same on the website server (otherwise every visitor shares one rate limit).',
    );

  const origin = env.FRONTEND_ORIGIN ?? '';
  if (!origin.startsWith('https://'))
    errors.push(
      'FRONTEND_ORIGIN must be the real https:// address of the website.',
    );

  if (/training|test|demo/i.test(env.DB_NAME ?? ''))
    errors.push(`DB_NAME "${env.DB_NAME}" looks like a training database.`);
  if ((env.DB_USER ?? '').toLowerCase() === 'root')
    errors.push(
      'DB_USER must not be root; use the limited application account.',
    );
  if ((env.DB_PASSWORD ?? '').length < 16)
    errors.push('DB_PASSWORD must be at least 16 characters.');

  if (!env.TRUST_PROXY)
    warnings.push(
      'TRUST_PROXY is not set. Behind Nginx/a load balancer, set it (usually 1) or sign-in limits will see every visitor as the proxy.',
    );
  if (/training/i.test(env.TOTP_ISSUER ?? ''))
    warnings.push(
      'TOTP_ISSUER still says "training"; staff will see this in their authenticator app.',
    );

  return { errors, warnings };
}

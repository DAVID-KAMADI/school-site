const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined || value === ''
    ? fallback
    : ['1', 'true', 'yes'].includes(value.toLowerCase());

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export interface AuthConfig {
  staffIdleMinutes: number;
  defaultIdleMinutes: number;
  maxSessionHours: number;
  secureCookies: boolean;
  requireStaffTwoFactor: boolean;
  totpEncryptionKey: string | undefined;
  totpIssuer: string;
  maxFailedLogins: number;
  lockoutMinutes: number;
}

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = env.NODE_ENV === 'production';
  return {
    staffIdleMinutes: int(env.SESSION_IDLE_MINUTES_STAFF, 15),
    defaultIdleMinutes: int(env.SESSION_IDLE_MINUTES_DEFAULT, 30),
    maxSessionHours: int(env.SESSION_MAX_HOURS, 12),
    secureCookies: bool(env.COOKIE_SECURE, production),
    requireStaffTwoFactor: bool(env.REQUIRE_STAFF_2FA, true),
    totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
    totpIssuer: env.TOTP_ISSUER || 'Institution Website',
    maxFailedLogins: int(env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(env.LOCKOUT_MINUTES, 15),
  };
}

export const SESSION_COOKIE = 'sid';
/** Short pass after opening a valid staff sign-in link (/admin/<token>). */
export const PORTAL_PASS_COOKIE = 'portal_pass';
/** Portal cookies are only ever sent to the sign-in endpoints. */
export const PORTAL_COOKIE_PATH = '/api/v1/auth';
export const XSRF_COOKIE = 'XSRF-TOKEN';
export const XSRF_HEADER = 'x-xsrf-token';

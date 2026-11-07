// Signs in as the synthetic staff account in loadtest/results/admin-cred.json (made with the project's own
// create-admin and portal-key commands; see loadtest/README.md), setting up two-step login on first use.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Visitor, sleep } from './lib.mjs';

const credFile = join(import.meta.dirname, 'results', 'admin-cred.json');
const { totpCode, currentStep } = await import(new URL('../backend/node_modules/.cache/claude-api/identity/totp.js', import.meta.url));

export async function signIn(base, rec) {
  const cred = JSON.parse(readFileSync(credFile, 'utf8'));
  const v = new Visitor(base, rec, { timeoutMs: 120_000 });
  await v.request('csrf', 'GET', '/api/v1/auth/csrf');
  await v.request('portal-link', 'POST', '/api/v1/auth/portal-access', { json: { key: cred.key } });
  const login = await v.request('login', 'POST', '/api/v1/auth/login', { json: { email: cred.email, password: cred.password } });
  if (!login.ok) throw new Error(`login failed ${login.status} ${login.text.slice(0, 200)}`);
  // A code can be used once; wait for the next 30-second step if the last sign-in used this one.
  if (cred.lastStep && cred.lastStep >= currentStep()) await sleep(((cred.lastStep + 1) * 30 - Date.now() / 1000) * 1000 + 500);
  if (!cred.totpSecret) {
    const setup = await v.request('2fa-setup', 'POST', '/api/v1/auth/2fa/setup', { json: {} });
    cred.totpSecret = setup.json.secret;
    const r = await v.request('2fa-enable', 'POST', '/api/v1/auth/2fa/enable', { json: { code: totpCode(cred.totpSecret, currentStep()) } });
    if (!r.ok) throw new Error(`2fa enable failed ${r.status} ${r.text.slice(0, 200)}`);
  } else {
    const r = await v.request('2fa-verify', 'POST', '/api/v1/auth/2fa/verify', { json: { code: totpCode(cred.totpSecret, currentStep()) } });
    if (!r.ok) throw new Error(`2fa verify failed ${r.status} ${r.text.slice(0, 200)}`);
  }
  cred.lastStep = currentStep();
  writeFileSync(credFile, JSON.stringify(cred, null, 1));
  return v;
}

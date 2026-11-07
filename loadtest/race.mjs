#!/usr/bin/env node
// Duplicate-request tests: what happens when the same action arrives twice (or more) at the same moment,
// as with a double-click, two open tabs, or a phone retrying on a bad connection.
// Usage: node loadtest/race.mjs [--trials 20]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ensureFixtures } from './fixtures.mjs';
import { Recorder, Visitor } from './lib.mjs';
import { plan, sections, uploadForm } from './scenarios.mjs';

const { values: a } = parseArgs({ options: { base: { type: 'string', default: 'http://127.0.0.1:4400' }, trials: { type: 'string', default: '20' } } });
const trials = Number(a.trials);
const runId = `race${Date.now().toString(36)}`;
const rec = new Recorder();
const files = await ensureFixtures();

const require = createRequire(join(import.meta.dirname, '../backend/package.json'));
const mysql = require('mysql2/promise');
const env = Object.fromEntries(readFileSync(join(import.meta.dirname, '../backend/.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const appsOf = async (email) => (await db.query('SELECT a.id, a.status FROM applications a JOIN users u ON u.id = a.applicant_id WHERE u.email = ?', [email]))[0];

async function newApplicant(i, tag) {
  const v = new Visitor(a.base, rec);
  const email = `lt-${runId}-${tag}${i}@loadtest.invalid`;
  const opts = await v.request('options', 'GET', '/api/v1/applicant/options');
  const r = await v.request('register', 'POST', '/api/v1/applicant/register', { json: { fullName: `Loadtest Race ${i}`, email, phone: '0712345678', password: `Lt-${runId}-Race-${i}!`, acceptTerms: true }, expect: [201] });
  return { v, email, opts: opts.json, ok: r.status === 201 };
}

const results = {};

// 1. Two tabs open the portal for the first time: does each create its own draft?
{
  let multi = 0;
  for (let i = 0; i < trials; i++) {
    const { v, email } = await newApplicant(i, 'tabs');
    await Promise.all([1, 2, 3].map(() => v.request('application', 'GET', '/api/v1/applicant/application')));
    if ((await appsOf(email)).length > 1) multi++;
  }
  results.firstOpenInThreeTabs = { trials, applicantsWithSeveralDrafts: multi };
}

// 2. Register pressed twice: one account, and the second press answered "already exists" (409), not an error (500)?
{
  const statuses = {};
  for (let i = 0; i < trials; i++) {
    const email = `lt-${runId}-reg${i}@loadtest.invalid`;
    const vs = [new Visitor(a.base, rec), new Visitor(a.base, rec)];
    await Promise.all(vs.map((v) => v.request('options', 'GET', '/api/v1/applicant/options')));
    const rs = await Promise.all(vs.map((v) => v.request('register', 'POST', '/api/v1/applicant/register', { json: { fullName: `Loadtest Reg ${i}`, email, phone: '0712345678', password: `Lt-${runId}-Reg-${i}!`, acceptTerms: true } })));
    const key = rs.map((r) => r.status).sort().join('+');
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  results.registerTwice = { trials, outcomes: statuses };
}

// 3. The same document uploaded twice at once: one file kept, or two of the same type?
{
  let dup = 0;
  for (let i = 0; i < trials; i++) {
    const { v, email } = await newApplicant(i, 'up');
    await v.request('application', 'GET', '/api/v1/applicant/application');
    await Promise.all([1, 2].map(() => v.request('upload', 'POST', '/api/v1/applicant/application/documents', { form: uploadForm(files.kcse, 2) })));
    const [rows] = await db.query('SELECT COUNT(*) n FROM application_documents d JOIN applications a ON a.id = d.application_id JOIN users u ON u.id = a.applicant_id WHERE u.email = ? AND d.document_type_id = 2', [email]);
    if (rows[0].n > 1) dup++;
  }
  results.uploadTwice = { trials, applicationsWithTwoCopies: dup };
}

// 4. Submit pressed twice: one "received" event and both presses answered sensibly?
{
  let dupEvents = 0;
  const statuses = {};
  for (let i = 0; i < trials; i++) {
    const { v, email, opts } = await newApplicant(i, 'sub');
    for (const [key, value] of Object.entries(sections(opts, i))) await v.request('section', 'PUT', `/api/v1/applicant/application/sections/${key}`, { json: { data: value } });
    for (const { typeId, file } of plan(opts, files)) await v.request('upload', 'POST', '/api/v1/applicant/application/documents', { form: uploadForm(file, typeId) });
    const rs = await Promise.all([1, 2].map(() => v.request('submit', 'POST', '/api/v1/applicant/application/submit', { json: { declaration: true } })));
    const key = rs.map((r) => r.status).sort().join('+');
    statuses[key] = (statuses[key] ?? 0) + 1;
    const [rows] = await db.query("SELECT COUNT(*) n FROM application_events e JOIN applications a ON a.id = e.application_id JOIN users u ON u.id = a.applicant_id WHERE u.email = ? AND e.to_status = 'submitted'", [email]);
    if (rows[0].n > 1) dupEvents++;
  }
  results.submitTwice = { trials, outcomes: statuses, applicationsWithTwoReceivedEvents: dupEvents };
}

// 5. Withdraw, then "start a new application" pressed twice: one new draft or two?
{
  let multi = 0;
  for (let i = 0; i < trials; i++) {
    const { v, email } = await newApplicant(i, 'new');
    await v.request('application', 'GET', '/api/v1/applicant/application');
    await v.request('withdraw', 'POST', '/api/v1/applicant/application/withdraw', { json: {} });
    await Promise.all([1, 2].map(() => v.request('new', 'POST', '/api/v1/applicant/application/new', { json: {} })));
    const open = (await appsOf(email)).filter((x) => x.status === 'draft').length;
    if (open > 1) multi++;
  }
  results.startNewTwice = { trials, applicantsWithTwoOpenDrafts: multi };
}

console.log(JSON.stringify({ runId, ...results }, null, 2));
const errors = rec.samples.filter((s) => s.status >= 500 || s.status === 0);
console.log('server errors during the race tests:', errors.length, errors.slice(0, 5).map((e) => `${e.label} ${e.status}`));
await db.end();

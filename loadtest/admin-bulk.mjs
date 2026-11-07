#!/usr/bin/env node
// Bulk work staff do by hand, timed with a full season of data present:
//   - media library: upload N synthetic photos, search them, delete them one after another, then N more deleted 10 at a time
//   - applications: move N submitted (seeded) applications to "under review" one after another, then N more 10 at a time
//   - two staff changing the same application at the same moment (does it record the change twice?)
// Only touches synthetic data: photos in the "loadtest" folder and lt-seed applications.
// Usage: node loadtest/admin-bulk.mjs --name admin-bulk [--count 50]
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { signIn } from './admin-auth.mjs';
import { ensureFixtures } from './fixtures.mjs';
import { Recorder, printReport, report } from './lib.mjs';

const { values: a } = parseArgs({ options: { base: { type: 'string', default: 'http://127.0.0.1:4400' }, name: { type: 'string', default: 'admin-bulk' }, count: { type: 'string', default: '50' } } });
const n = Number(a.count);
const rec = new Recorder();
const admin = await signIn(a.base, rec);
const files = await ensureFixtures();

/** Runs fn over items, `width` at a time. */
async function inParallel(items, width, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: width }, async () => { while (queue.length) await fn(queue.shift()); }));
}

const uploadMedia = async (i) => {
  const form = new FormData();
  form.append('folder', 'loadtest');
  form.append('altText', `Synthetic load-test photo ${i}`);
  form.append('file', new Blob([files.photo.data], { type: files.photo.type }), `lt-photo-${i}.jpg`);
  const r = await admin.request('media upload', 'POST', '/api/v1/admin/media', { form });
  return r.json?.id;
};

// Media: upload, search, delete one by one.
rec.setStage(`media: ${n} uploads, one after another`);
const ids1 = [];
for (let i = 0; i < n; i++) ids1.push(await uploadMedia(i));
rec.setStage('media: list and search');
for (let r = 0; r < 5; r++) {
  await admin.request('media list p1', 'GET', '/api/v1/admin/media?page=1&pageSize=48');
  await admin.request('media search', 'GET', '/api/v1/admin/media?search=lt-photo');
  await admin.request('media folder', 'GET', '/api/v1/admin/media?folder=loadtest');
}
rec.setStage(`media: delete ${n}, one after another`);
for (const id of ids1.filter(Boolean)) await admin.request('media delete', 'DELETE', `/api/v1/admin/media/${id}`, { expect: [200, 204] });

rec.setStage(`media: ${n} uploads, 10 at a time`);
const ids2 = [];
await inParallel([...Array(n).keys()], 10, async (i) => ids2.push(await uploadMedia(n + i)));
rec.setStage(`media: delete ${n}, 10 at a time`);
await inParallel(ids2.filter(Boolean), 10, (id) => admin.request('media delete', 'DELETE', `/api/v1/admin/media/${id}`, { expect: [200, 204] }));
const left = await admin.request('media check', 'GET', '/api/v1/admin/media?folder=loadtest&pageSize=100');

// Applications: status changes on seeded, submitted applications.
const list = await admin.request('applications list', 'GET', `/api/v1/admin/applications?status=submitted&search=lt-seed&pageSize=100&page=1`);
const list2 = await admin.request('applications list', 'GET', `/api/v1/admin/applications?status=submitted&search=lt-seed&pageSize=100&page=2`);
const subs = [...(list.json?.items ?? []), ...(list2.json?.items ?? [])].map((x) => x.id);
const move = (id) => admin.request('status change', 'POST', `/api/v1/admin/applications/${id}/status`, { json: { status: 'under_review' } });
rec.setStage(`status: ${Math.min(n, subs.length)} changes, one after another`);
for (const id of subs.slice(0, n)) await move(id);
rec.setStage(`status: ${Math.min(n, subs.slice(n).length)} changes, 10 at a time`);
await inParallel(subs.slice(n, 2 * n), 10, move);

// Two staff, same application, same moment (20 trials).
rec.setStage('status: same application, two staff at once');
const race = subs.slice(2 * n, 2 * n + 20);
const outcomes = {};
for (const id of race) {
  const [x, y] = await Promise.all([move(id), move(id)]);
  const k = [x.status, y.status].sort().join('+');
  outcomes[k] = (outcomes[k] ?? 0) + 1;
}

// How many "under review" events each raced application got (should be 1).
const require = createRequire(join(import.meta.dirname, '../backend/package.json'));
const mysql = require('mysql2/promise');
const env = Object.fromEntries(readFileSync(join(import.meta.dirname, '../backend/.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const [twice] = race.length
  ? await db.query("SELECT application_id, COUNT(*) c FROM application_events WHERE type = 'status' AND to_status = 'under_review' AND application_id IN (?) GROUP BY application_id HAVING c > 1", [race])
  : [[]];
await db.end();

const rows = report(rec);
printReport(rows);
const summary = { mediaLeftInLoadtestFolder: left.json?.total, raceTrials: race.length, raceOutcomes: outcomes, racedApplicationsWithTwoEvents: twice.length };
console.log(summary);
writeFileSync(join(import.meta.dirname, 'results', `${a.name}.json`), JSON.stringify({ name: a.name, summary, stages: rows }, null, 1));
console.log(`results: loadtest/results/${a.name}.json`);

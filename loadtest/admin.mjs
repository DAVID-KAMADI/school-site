#!/usr/bin/env node
// Times the admin screens that grow with the data: dashboard, application counts, lists, searches,
// deep pages, CSV export, applicant list and audit log. Signs in as a synthetic staff account
// (made with the project's own create-admin and portal-key commands; see loadtest/README.md).
// Usage: node loadtest/admin.mjs --name admin-baseline [--staff 10] [--repeat 5]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { signIn } from './admin-auth.mjs';
import { Recorder, printReport, report } from './lib.mjs';

const { values: a } = parseArgs({ options: { base: { type: 'string', default: 'http://127.0.0.1:4400' }, name: { type: 'string', default: 'admin' }, staff: { type: 'string', default: '10' }, repeat: { type: 'string', default: '5' } } });
const rec = new Recorder();

const admin = await signIn(a.base, rec);
const counts = await admin.request('warm', 'GET', '/api/v1/admin/applications/counts');
const total = Object.values(counts.json ?? {}).reduce((s, n) => s + Number(n), 0);
console.log(`applications in the database: ${total}`, counts.json);
const deepPage = Math.max(1, Math.floor((total - (counts.json?.draft ?? 0)) / 50) - 1);

const screens = [
  ['dashboard', '/api/v1/admin/dashboard'],
  ['counts', '/api/v1/admin/applications/counts'],
  ['list p1', '/api/v1/admin/applications?page=1&pageSize=50'],
  ['list deep page', `/api/v1/admin/applications?page=${deepPage}&pageSize=50`],
  ['list status filter', '/api/v1/admin/applications?status=under_review&page=1'],
  ['search name', '/api/v1/admin/applications?search=Wanjiku'],
  ['search number', '/api/v1/admin/applications?search=APP-2026-0001'],
  ['search email', '/api/v1/admin/applications?search=lt-seed'],
  ['search no match', '/api/v1/admin/applications?search=zzzz-no-such-person'],
  ['applicants p1', '/api/v1/admin/applicants?page=1'],
  ['applicants search', '/api/v1/admin/applicants?search=Otieno'],
  ['audit log p1', '/api/v1/admin/audit?page=1'],
];

rec.setStage('1 admin');
for (let r = 0; r < Number(a.repeat); r++) for (const [label, path] of screens) await admin.request(label, 'GET', path);
await admin.request('export csv (all)', 'GET', '/api/v1/admin/applications/export.csv');

// Several staff working at once: each runs through the screens. They share one session here
// (signing in many staff accounts would only test the sign-in), which is the same load on the database.
rec.setStage(`${a.staff} admins at once`);
await Promise.all(
  Array.from({ length: Number(a.staff) }, async () => {
    for (const [label, path] of screens) await admin.request(label, 'GET', path);
  }),
);
rec.setStage(`${a.staff} CSV exports at once`);
await Promise.all(Array.from({ length: Number(a.staff) }, () => admin.request('export csv (all)', 'GET', '/api/v1/admin/applications/export.csv')));

const rows = report(rec);
printReport(rows);
writeFileSync(join(import.meta.dirname, 'results', `${a.name}.json`), JSON.stringify({ name: a.name, total, counts: counts.json, stages: rows }, null, 1));
console.log(`results: loadtest/results/${a.name}.json`);

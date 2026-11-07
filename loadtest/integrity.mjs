#!/usr/bin/env node
// Compares what applicants were told during a run with what the database holds.
// Usage: node loadtest/integrity.mjs loadtest/results/<run>.json
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const file = process.argv[2];
const run = JSON.parse(readFileSync(file, 'utf8'));
const require = createRequire(join(import.meta.dirname, '../backend/package.json'));
const mysql = require('mysql2/promise');
const envText = readFileSync(join(import.meta.dirname, '../backend/.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });

const pattern = `lt-${run.runId}-%@loadtest.invalid`;
const q = async (sql, params = []) => (await db.query(sql, [pattern, ...params]))[0];

const users = await q('SELECT id, email FROM users WHERE email LIKE ?');
const apps = await q(`SELECT a.id, a.status, a.application_number, a.submitted_at, u.email, a.applicant_id
  FROM applications a JOIN users u ON u.id = a.applicant_id WHERE u.email LIKE ?`);
const events = await q(`SELECT e.application_id, COUNT(*) n FROM application_events e
  JOIN applications a ON a.id = e.application_id JOIN users u ON u.id = a.applicant_id
  WHERE u.email LIKE ? AND e.type = 'status' AND e.to_status = 'submitted' GROUP BY e.application_id`);
const docs = await q(`SELECT d.id, d.storage_key, d.application_id, d.document_type_id, a.applicant_id FROM application_documents d
  JOIN applications a ON a.id = d.application_id JOIN users u ON u.id = a.applicant_id WHERE u.email LIKE ?`);

const appsByEmail = new Map();
for (const a of apps) appsByEmail.set(a.email, [...(appsByEmail.get(a.email) ?? []), a]);
const outcomes = run.outcomes;
const told = (o) => o.submitted;

const lost = outcomes.filter((o) => told(o) && !(appsByEmail.get(o.email) ?? []).some((a) => a.status === 'submitted' && a.application_number));
const phantom = outcomes.filter((o) => !told(o) && o.submitStatuses?.length && (appsByEmail.get(o.email) ?? []).some((a) => a.status === 'submitted'));
const multiDraft = [...appsByEmail.entries()].filter(([, list]) => list.length > 1);
const dupEvents = events.filter((e) => e.n > 1);
const submittedNoNumber = apps.filter((a) => a.status === 'submitted' && !a.application_number);
const numbers = apps.map((a) => a.application_number).filter(Boolean);
const dupNumbers = numbers.length - new Set(numbers).size;
// Two documents of the same type on one application = a duplicate upload (a retried or double request).
const docKey = new Map();
for (const d of docs) docKey.set(`${d.application_id}:${d.document_type_id}`, (docKey.get(`${d.application_id}:${d.document_type_id}`) ?? 0) + 1);
const dupDocs = [...docKey.values()].filter((n) => n > 1).length;
const storageRoot = join(import.meta.dirname, '../backend', env.STORAGE_DIR || 'storage', 'private');
const missingFiles = docs.filter((d) => !existsSync(join(storageRoot, d.storage_key))).length;

const result = {
  run: run.name,
  accountsInDb: users.length,
  registeredPerClient: outcomes.filter((o) => o.registered).length,
  applicationsInDb: apps.length,
  submittedInDb: apps.filter((a) => a.status === 'submitted').length,
  toldSubmitted: outcomes.filter(told).length,
  lostSubmissions: lost.length,
  submittedButToldFailure: phantom.length,
  applicantsWithMoreThanOneApplication: multiDraft.length,
  duplicateSubmittedEvents: dupEvents.length,
  submittedWithoutNumber: submittedNoNumber.length,
  duplicateApplicationNumbers: dupNumbers,
  documentsInDb: docs.length,
  duplicateDocumentsSameType: dupDocs,
  documentsMissingOnDisk: missingFiles,
  storageCheckedAt: storageRoot,
};
console.log(JSON.stringify(result, null, 2));
if (multiDraft.length) console.log('examples of applicants with several applications:', multiDraft.slice(0, 3).map(([e, l]) => `${e}: ${l.map((x) => `${x.id}/${x.status}`).join(', ')}`));
if (lost.length) console.log('lost:', lost.slice(0, 5).map((o) => o.email));
await db.end();

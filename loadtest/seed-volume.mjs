#!/usr/bin/env node
// Adds a large volume of synthetic applicants and applications straight into the database, to see how the
// site and the admin screens behave with a full admissions season of records already present.
// Every account: lt-seed-<batch>-<n>@loadtest.invalid, all sharing one test password (saved in loadtest/results/seed-accounts.json).
// No documents are created for these (their files would be empty); the applications are otherwise complete.
// Usage: node loadtest/seed-volume.mjs --count 10000
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { count: { type: 'string', default: '10000' } } });
const count = Number(a.count);
const require = createRequire(join(import.meta.dirname, '../backend/package.json'));
const mysql = require('mysql2/promise');
const argon2 = require('argon2');
const env = Object.fromEntries(readFileSync(join(import.meta.dirname, '../backend/.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });

const batch = Date.now().toString(36);
const password = `Lt-seed-${batch}-Pass!`;
const hash = await argon2.hash(password, { type: argon2.argon2id });
const [[role]] = await db.query("SELECT id FROM roles WHERE `key` = 'applicant'");
const [programmes] = await db.query('SELECT id, study_modes FROM programmes WHERE is_active = 1');
const [intakes] = await db.query('SELECT id FROM intakes WHERE is_active = 1');
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const FIRST = ['Achieng', 'Brian', 'Wanjiku', 'Kevin', 'Faith', 'Otieno', 'Mercy', 'Dennis', 'Aisha', 'Kiprono', 'Grace', 'Mwangi', 'Halima', 'Juma', 'Nekesa'];
const LAST = ['Loadtest', 'Synthetic', 'Testcase', 'Sample', 'Fixture'];
// Rough shape of an admissions season: most submitted or in review, some decided, a fifth still drafts.
const STATUS = [['draft', 20], ['submitted', 35], ['under_review', 20], ['info_requested', 5], ['offered', 8], ['accepted', 4], ['rejected', 5], ['withdrawn', 3]];
const statusPick = () => {
  let r = Math.random() * 100;
  for (const [s, w] of STATUS) if ((r -= w) < 0) return s;
  return 'submitted';
};
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

console.log(`seeding ${count} applicants as batch ${batch}`);
const t0 = Date.now();
const CHUNK = 500;
for (let start = 0; start < count; start += CHUNK) {
  const n = Math.min(CHUNK, count - start);
  const now = Date.now();
  const users = Array.from({ length: n }, (_, k) => {
    const i = start + k;
    const created = new Date(now - Math.random() * 60 * 864e5);
    return [`lt-seed-${batch}-${i}@loadtest.invalid`, `07${digits(8)}`, `${pick(FIRST)} ${pick(LAST)} ${i}`, hash, 'active', 'applicant', fmt(created), fmt(created), fmt(created)];
  });
  const [res] = await db.query('INSERT INTO users (email, phone, full_name, password_hash, status, account_type, password_changed_at, terms_accepted_at, created_at) VALUES ?', [users]);
  const firstId = res.insertId;
  await db.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [users.map((_, k) => [firstId + k, role.id])]);
  const apps = users.map((u, k) => {
    const status = statusPick();
    const p = pick(programmes);
    const modes = typeof p.study_modes === 'string' ? JSON.parse(p.study_modes) : p.study_modes;
    const created = new Date(u[6]);
    const submitted = status === 'draft' ? null : new Date(created.getTime() + Math.random() * 5 * 864e5);
    const grade = pick(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-']);
    const personal = { firstName: u[2].split(' ')[0], lastName: u[2].split(' ').slice(1).join(' '), gender: pick(['female', 'male']), country: 'Kenya', county: 'Nairobi', idType: 'national_id', idNumber: digits(8), phone: u[1], address: 'P.O. Box 100 Test Town', dateOfBirth: '2004-05-12', nationality: 'Kenyan' };
    return [
      null, // number set below, once the id is known
      pick(modes ?? ['full_time']),
      status,
      JSON.stringify(personal),
      JSON.stringify({ name: 'Synthetic Guardian', relationship: 'Parent', phone: `07${digits(8)}`, email: '' }),
      JSON.stringify({ kcseIndexNumber: digits(11), kcseYear: 2023, meanGrade: grade, secondarySchool: 'Synthetic High School', subjects: [], otherQualifications: [] }),
      JSON.stringify({ method: pick(['self', 'helb', 'parent_guardian']), sponsorName: '' }),
      u[2],
      u[1],
      digits(11),
      grade,
      submitted ? fmt(submitted) : null,
      Math.random() < 0.4 && status !== 'draft' ? 'claimed' : 'unpaid',
      submitted ? fmt(submitted) : null,
      fmt(created),
      firstId + k,
      pick(intakes).id,
      p.id,
    ];
  });
  const [ar] = await db.query(
    'INSERT INTO applications (application_number, study_mode, status, personal, next_of_kin, education, funding, full_name, phone, kcse_index_number, mean_grade, declaration_accepted_at, fee_status, submitted_at, created_at, applicant_id, intake_id, programme_id) VALUES ?',
    [apps],
  );
  // Application numbers follow the app's own pattern: APP-<year>-<id padded to 6>.
  await db.query("UPDATE applications SET application_number = CONCAT('APP-', YEAR(submitted_at), '-', LPAD(id, 6, '0')) WHERE id BETWEEN ? AND ? AND status <> 'draft'", [ar.insertId, ar.insertId + n - 1]);
  await db.query(
    "INSERT INTO application_events (type, from_status, to_status, message, visible_to_applicant, created_at, application_id, actor_id) SELECT 'status', 'draft', 'submitted', 'Application received. We will review it and get back to you.', 1, submitted_at, id, applicant_id FROM applications WHERE id BETWEEN ? AND ? AND status <> 'draft'",
    [ar.insertId, ar.insertId + n - 1],
  );
  process.stdout.write(`\r${start + n}/${count}`);
}
mkdirSync(join(import.meta.dirname, 'results'), { recursive: true });
writeFileSync(join(import.meta.dirname, 'results', 'seed-accounts.json'), JSON.stringify({ batch, emailPattern: `lt-seed-${batch}-<n>@loadtest.invalid`, count, password }, null, 1));
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s. Accounts and their test password: loadtest/results/seed-accounts.json`);
const [[c]] = await db.query('SELECT COUNT(*) n FROM applications');
console.log(`applications in the database now: ${c.n}`);
await db.end();

#!/usr/bin/env node
// Load test runner. Examples (run from the project root):
//   node loadtest/run.mjs --profile steps --levels 1,10,25,50,100,150,200 --stage 90 --mix browse:65,apply:30,returning:5
//   node loadtest/run.mjs --profile spike
//   node loadtest/run.mjs --profile endurance --users 50 --duration 1200
//   node loadtest/run.mjs --profile submit-burst --users 100
//   node loadtest/run.mjs --profile login-burst --users 100
//   node loadtest/run.mjs --profile upload-burst --users 50
// Results: loadtest/results/<name>.json (per-stage statistics + what each applicant was told).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ensureFixtures } from './fixtures.mjs';
import { Recorder, Visitor, printReport, report, sleep } from './lib.mjs';
import { apply, browse, plan, returning, sections, uploadForm } from './scenarios.mjs';

const { values: a } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:4400' },
    profile: { type: 'string', default: 'steps' },
    levels: { type: 'string', default: '1,10,25,50,100,150,200' },
    stage: { type: 'string', default: '90' },
    users: { type: 'string', default: '50' },
    duration: { type: 'string', default: '600' },
    mix: { type: 'string', default: 'browse:65,apply:30,returning:5' },
    think: { type: 'string', default: '0.3' },
    abandon: { type: 'string', default: '0.2' },
    double: { type: 'string', default: '0.1' },
    slow: { type: 'string', default: '0.15' },
    name: { type: 'string' },
  },
});

const runId = Date.now().toString(36);
const name = a.name ?? `${a.profile}-${runId}`;
const resultsDir = join(import.meta.dirname, 'results');
mkdirSync(resultsDir, { recursive: true });
const accountsFile = join(resultsDir, 'accounts.json');

const rec = new Recorder();
const ctx = {
  runId,
  think: Number(a.think),
  abandonRate: Number(a.abandon),
  doubleSubmitRate: Number(a.double),
  nextApplicant: 0,
  outcomes: [],
  submittedTimes: [],
  // Accounts from earlier runs, so "returning applicant" journeys have someone to sign in as.
  accounts: existsSync(accountsFile) ? JSON.parse(readFileSync(accountsFile, 'utf8')) : [],
  files: await ensureFixtures(),
};

const mix = a.mix.split(',').map((p) => {
  const [k, w] = p.split(':');
  return { fn: { browse, apply, returning }[k], w: Number(w) };
});
const total = mix.reduce((s, m) => s + m.w, 0);
const pickJourney = () => {
  let r = Math.random() * total;
  for (const m of mix) if ((r -= m.w) < 0) return m.fn;
  return mix[0].fn;
};

/** Closed model: `target` visitors are active; each runs journeys back to back until it is no longer needed. */
let target = 0;
let running = 0;
let stopping = false;
async function visitorLoop(id) {
  running++;
  try {
    while (!stopping && id < target) {
      const v = new Visitor(a.base, rec, { slow: Math.random() < Number(a.slow) });
      try {
        await pickJourney()(v, ctx);
      } catch (err) {
        rec.add({ label: 'journey-crash', status: 0, ms: 0, ok: false, error: String(err?.message ?? err) });
      }
    }
  } finally {
    running--;
  }
}
let spawned = 0;
function setUsers(n) {
  target = n;
  // Ids below the target that are not running get a loop; ids above stop after their journey.
  for (; spawned < n; spawned++) void visitorLoop(spawned);
  if (n < spawned) spawned = n;
}

async function schedule(steps) {
  for (const [users, seconds] of steps) {
    rec.setStage(`${String(users).padStart(3)} users`);
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${users} users for ${seconds}s`);
    setUsers(users);
    await sleep(seconds * 1000);
  }
  stopping = true;
  rec.setStage('drain');
  console.log('waiting for running journeys to finish...');
  while (running > 0) await sleep(500);
}

/** Many applicants with complete drafts press Submit at the same moment (some twice). */
async function submitBurst(n) {
  rec.setStage('prepare');
  const ready = [];
  const prep = async (i) => {
    const v = new Visitor(a.base, rec);
    const email = `lt-${runId}-burst${i}@loadtest.invalid`;
    const password = `Lt-${runId}-Burst-${i}!`;
    const opts = await v.request('api:options', 'GET', '/api/v1/applicant/options');
    const reg = await v.request('api:register', 'POST', '/api/v1/applicant/register', { json: { fullName: `Loadtest Burst ${i}`, email, phone: '0712345678', password, acceptTerms: true }, expect: [201] });
    if (reg.status !== 201) return;
    ctx.accounts.push({ email, password });
    for (const [key, value] of Object.entries(sections(opts.json, i))) await v.request('api:save-section', 'PUT', `/api/v1/applicant/application/sections/${key}`, { json: { data: value } });
    for (const { typeId, file } of plan(opts.json, ctx.files)) await v.request('api:upload', 'POST', '/api/v1/applicant/application/documents', { form: uploadForm(file, typeId) });
    const outcome = { email, n: i, registered: true, submitted: false, submitStatuses: [], finalStatus: null, applicationNumber: null };
    ctx.outcomes.push(outcome);
    ready.push({ v, outcome, double: Math.random() < 0.2 });
  };
  // Prepared ten at a time so preparation itself is not the test.
  for (let i = 0; i < n; i += 10) await Promise.all(Array.from({ length: Math.min(10, n - i) }, (_, k) => prep(i + k)));
  console.log(`${ready.length} applicants ready; submitting together`);
  rec.setStage(`submit x${ready.length}`);
  await Promise.all(
    ready.map(async ({ v, outcome, double }) => {
      const submit = () => v.request('api:submit', 'POST', '/api/v1/applicant/application/submit', { json: { declaration: true } });
      const rs = double ? await Promise.all([submit(), submit()]) : [await submit()];
      outcome.submitStatuses = rs.map((r) => r.status);
      outcome.submitted = rs.some((r) => r.status === 200);
    }),
  );
  rec.setStage('status check');
  await Promise.all(
    ready.map(async ({ v, outcome }) => {
      const s = await v.request('api:status', 'GET', '/api/v1/applicant/application');
      outcome.finalStatus = s.json?.status ?? null;
      outcome.applicationNumber = s.json?.applicationNumber ?? null;
    }),
  );
}

/** Many people sign in at the same moment (password checking is deliberately slow). */
async function loginBurst(n) {
  const accts = ctx.accounts.slice(-n);
  if (accts.length < n) console.log(`only ${accts.length} test accounts available`);
  rec.setStage(`login x${accts.length}`);
  await Promise.all(
    accts.map(async (acct) => {
      const v = new Visitor(a.base, rec);
      await v.request('api:csrf', 'GET', '/api/v1/auth/csrf');
      await v.request('api:login', 'POST', '/api/v1/auth/login', { json: { email: acct.email, password: acct.password } });
    }),
  );
}

/** Many applicants upload a photo at the same moment (each photo is re-encoded by the server). */
async function uploadBurst(n) {
  rec.setStage('prepare');
  const vs = [];
  for (let i = 0; i < n; i += 10)
    await Promise.all(
      Array.from({ length: Math.min(10, n - i) }, async (_, k) => {
        const v = new Visitor(a.base, rec);
        const email = `lt-${runId}-up${i + k}@loadtest.invalid`;
        const password = `Lt-${runId}-Up-${i + k}!`;
        await v.request('api:options', 'GET', '/api/v1/applicant/options');
        const reg = await v.request('api:register', 'POST', '/api/v1/applicant/register', { json: { fullName: `Loadtest Upload ${i + k}`, email, phone: '0712345678', password, acceptTerms: true }, expect: [201] });
        if (reg.status === 201) {
          ctx.accounts.push({ email, password });
          await v.request('api:application', 'GET', '/api/v1/applicant/application');
          vs.push(v);
        }
      }),
    );
  const photoType = 3;
  rec.setStage(`upload x${vs.length}`);
  await Promise.all(vs.map((v) => v.request('api:upload', 'POST', '/api/v1/applicant/application/documents', { form: uploadForm(ctx.files.photo, photoType) })));
  rec.setStage(`upload pdf x${vs.length}`);
  await Promise.all(vs.map((v) => v.request('api:upload', 'POST', '/api/v1/applicant/application/documents', { form: uploadForm(ctx.files.kcse, 2) })));
}

const started = new Date();
const p = a.profile;
if (p === 'steps') {
  await schedule(a.levels.split(',').map((u) => [Number(u), Number(a.stage)]));
} else if (p === 'spike') {
  await schedule([[10, 60], [50, 30], [100, 30], [150, 60], [10, 90]]);
} else if (p === 'endurance') {
  // Measured in 2-minute windows so slow drift shows.
  const windows = Math.ceil(Number(a.duration) / 120);
  await schedule(Array.from({ length: windows }, () => [Number(a.users), 120]));
} else if (p === 'submit-burst') await submitBurst(Number(a.users));
else if (p === 'login-burst') await loginBurst(Number(a.users));
else if (p === 'upload-burst') await uploadBurst(Number(a.users));
else throw new Error(`unknown profile ${p}`);

// Endurance: one row per 2-minute window, so slow drift over time shows.
if (p === 'endurance') {
  const t0 = rec.samples[0]?.t ?? Date.now();
  for (const s of rec.samples) if (s.stage !== 'drain') s.stage = `window ${String(1 + Math.floor((s.t - t0) / 120_000)).padStart(2)}`;
}

const rows = report(rec);
printReport(rows);
const outcomes = ctx.outcomes;
const integrity = {
  applicantsStarted: outcomes.length,
  registered: outcomes.filter((o) => o.registered).length,
  abandoned: outcomes.filter((o) => o.abandonedAt).length,
  submitAttempts: outcomes.filter((o) => o.submitStatuses?.length).length,
  submittedOk: outcomes.filter((o) => o.submitted).length,
  doubleSubmits: outcomes.filter((o) => o.submitStatuses?.length === 2).length,
  submitStatusCounts: outcomes.flatMap((o) => o.submitStatuses ?? []).reduce((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {}),
  statusAfterSubmit: outcomes.filter((o) => o.submitted).reduce((m, o) => ((m[o.finalStatus] = (m[o.finalStatus] ?? 0) + 1), m), {}),
  submittedWithoutNumber: outcomes.filter((o) => o.submitted && !o.applicationNumber).length,
};
console.log('\nintegrity (client side):', JSON.stringify(integrity));
writeFileSync(accountsFile, JSON.stringify(ctx.accounts));
writeFileSync(join(resultsDir, `${name}.json`), JSON.stringify({ name, profile: p, args: a, runId, started, finished: new Date(), stages: rows, integrity, outcomes, events: rec.events }, null, 1));
console.log(`results: loadtest/results/${name}.json  (runId ${runId})`);
process.exit(0);

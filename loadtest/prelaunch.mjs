#!/usr/bin/env node
// Pre-launch check (work plan H3): runs the key load tests against a staging copy on the production server
// and says, test by test, whether the site meets the targets. Run it from the project on that server, so
// the database checks read the same database (backend/.env) the staging site uses.
//
//   node loadtest/prelaunch.mjs --base http://127.0.0.1:4000 --peak 300
//
// --peak = the most people you expect on the site at the same moment (each simulated user is about 3 times
// busier than a real visitor, so 300 here is roughly 900 real visitors). Takes about 15 minutes.
// Refuses any address other than this machine unless --staging is given. Never point it at the live site.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:4400' },
    peak: { type: 'string', default: '300' },
    staging: { type: 'boolean', default: false },
  },
});
const host = new URL(a.base).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) && !a.staging) {
  console.error(`${a.base} is not this machine. If it is a staging copy (never the live site), add --staging.`);
  process.exit(1);
}
const peak = Number(a.peak);
const dir = import.meta.dirname;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const node = (script, args) => {
  console.log(`\n> node loadtest/${script} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [join(dir, script), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  process.stdout.write(r.stdout.split('\n').filter((l) => l.startsWith('==')).join('\n') + '\n');
  return r.stdout;
};
const results = (name) => JSON.parse(readFileSync(join(dir, 'results', `${name}.json`), 'utf8'));
const integrity = (out) => JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));

const checks = [];
const check = (test, target, actual, pass) => checks.push({ test, target, actual, pass });

// 1. Mixed visitors and applicants, stepping up to the expected peak.
const levels = [...new Set([50, 100, Math.round(peak * 0.66), peak])].filter((n) => n > 0 && n <= peak).sort((x, y) => x - y);
const stepsName = `prelaunch-steps-${stamp}`;
node('run.mjs', ['--base', a.base, '--profile', 'steps', '--levels', levels.join(','), '--stage', '90', '--think', '0.3', '--abandon', '0.2', '--double', '0.1', '--slow', '0.15', '--name', stepsName]);
for (const s of results(stepsName).stages.filter((s) => s.stage !== 'drain')) {
  check(`${s.stage}: errors`, 'under 0.5%', `${s.all.errorRate}%`, s.all.errorRate < 0.5);
  check(`${s.stage}: slowest 5% (p95)`, 'under 1.0 s', `${(s.all.p95 / 1000).toFixed(2)} s`, s.all.p95 < 1000);
}
const steps = integrity(node('integrity.mjs', [join(dir, 'results', `${stepsName}.json`)]));
check('Applications lost', '0', String(steps.lostSubmissions), steps.lostSubmissions === 0);
const dupes = steps.applicantsWithMoreThanOneApplication + steps.duplicateSubmittedEvents + steps.duplicateDocumentsSameType + steps.duplicateApplicationNumbers;
check('Duplicates (applications, events, documents, numbers)', '0', String(dupes), dupes === 0);
check('Uploaded files missing on disk', '0', String(steps.documentsMissingOnDisk), steps.documentsMissingOnDisk === 0);

// 2. A sudden rush.
const spikeName = `prelaunch-spike-${stamp}`;
node('run.mjs', ['--base', a.base, '--profile', 'spike', '--think', '0.3', '--slow', '0.15', '--name', spikeName]);
const spikeErrors = Math.max(...results(spikeName).stages.map((s) => s.all.errorRate));
check('Spike 10 to 150 users: errors', '0%', `${spikeErrors}%`, spikeErrors === 0);

// 3. Everyone submits in the same second (closing day).
const burst = Math.min(200, Math.max(50, Math.round(peak / 3)));
const burstName = `prelaunch-submit-${stamp}`;
node('run.mjs', ['--base', a.base, '--profile', 'submit-burst', '--users', String(burst), '--name', burstName]);
const b = results(burstName);
const submitStage = b.stages.find((s) => s.stage.startsWith('submit'));
check(`${burst} submissions at once: all stored`, `${burst}`, String(b.integrity.submittedOk), b.integrity.submittedOk === burst && b.integrity.submittedWithoutNumber === 0);
check(`${burst} submissions at once: slowest 5%`, 'under 5 s', `${(submitStage.all.p95 / 1000).toFixed(2)} s`, submitStage.all.p95 < 5000);

// Report.
const width = Math.max(...checks.map((c) => c.test.length));
console.log(`\nPre-launch check against ${a.base}, peak ${peak} users\n`);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.test.padEnd(width)}  target ${c.target.padEnd(12)} measured ${c.actual}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `\n${failed} check(s) failed: see the work plan for what to change, then run this again.` : '\nAll checks passed.');
writeFileSync(join(dir, 'results', `prelaunch-${stamp}.json`), JSON.stringify({ base: a.base, peak, checks }, null, 1));
console.log(`results: loadtest/results/prelaunch-${stamp}.json`);
process.exit(failed ? 1 : 0);

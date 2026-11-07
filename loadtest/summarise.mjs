#!/usr/bin/env node
// Joins a run's results with its monitor samples: one line per stage with latency and resource use.
// Usage: node loadtest/summarise.mjs loadtest/results/<run>.json loadtest/results/monitor-<run>.csv
import { readFileSync } from 'node:fs';
const [runFile, monFile] = process.argv.slice(2);
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const lines = monFile ? readFileSync(monFile, 'utf8').trim().split(/\r?\n/) : [];
const cols = lines.length ? lines[0].split(',') : [];
const day = run.started.slice(0, 10);
const mon = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v === '' ? null : Number.isNaN(Number(v)) ? v : Number(v)]))).map((r) => ({ ...r, t: Date.parse(`${day}T${r.time}Z`) }));
const ev = run.events;
const avg = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(0) : '');
const max = (xs) => (xs.length ? Math.max(...xs) : '');
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : ''; };
console.log('stage | req | req/s | err% | avg | p50 | p90 | p95 | p99 | max ms | api cpu% avg/max | web cpu% avg/max | db cpu% avg | api MB | web MB max | db busy conns max | health p95 ms');
for (const st of run.stages) {
  const i = ev.findIndex((e) => e.stage === st.stage);
  const t0 = i >= 0 ? ev[i].t : 0, t1 = i >= 0 && ev[i + 1] ? ev[i + 1].t : Infinity;
  const m = mon.filter((r) => r.t >= t0 && r.t < t1 && r.apiCpu != null);
  const a = st.all;
  console.log([st.stage, a.requests, a.rps, a.errorRate, a.avg, a.p50, a.p90, a.p95, a.p99, a.max, `${avg(m.map((r) => r.apiCpu))}/${max(m.map((r) => r.apiCpu))}`, `${avg(m.map((r) => r.webCpu))}/${max(m.map((r) => r.webCpu))}`, avg(m.map((r) => r.dbCpu)), max(m.map((r) => r.apiMem)), max(m.map((r) => r.webMem)), max(m.map((r) => r.appBusy)), pct(m.map((r) => r.healthMs), 95)].join(' | '));
}

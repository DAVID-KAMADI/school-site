#!/usr/bin/env node
// Where a server spent its CPU time: self time per function and per package, from a .cpuprofile file.
// Usage: node loadtest/profile-top.mjs <file.cpuprofile> [rows]
import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rows = Number(process.argv[3] ?? 25);
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas;
for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (dt[i] ?? 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const fn = new Map(), pkg = new Map();
for (const [id, us] of self) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const url = cf.url || '(native)';
  const key = `${cf.functionName || '(anonymous)'}  ${url.replace(/^.*node_modules[\/]/, 'nm:').replace(/^.*[\/](dist|claude-api|server)[\/]/, '$1/')}:${cf.lineNumber + 1}`;
  fn.set(key, (fn.get(key) ?? 0) + us);
  const m = url.match(/node_modules[\/](@[^\/]+[\/][^\/]+|[^\/]+)/);
  const group = cf.functionName === '(idle)' ? '(idle)' : cf.functionName === '(garbage collector)' ? '(gc)' : m ? m[1] : url.startsWith('node:') ? 'node core' : url ? 'app code' : '(native/other)';
  pkg.set(group, (pkg.get(group) ?? 0) + us);
}
const fmt = (us) => `${(us / 1e6).toFixed(2)}s ${((us / total) * 100).toFixed(1)}%`;
console.log(`profile ${(total / 1e6).toFixed(1)} s sampled`);
console.log('\nby package:');
for (const [k, v] of [...pkg].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${fmt(v).padEnd(16)} ${k}`);
console.log('\nby function (self time):');
for (const [k, v] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, rows)) console.log(`  ${fmt(v).padEnd(16)} ${k}`);

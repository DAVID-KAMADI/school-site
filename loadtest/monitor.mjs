#!/usr/bin/env node
// Samples the servers every 2 s while a test runs:
//   CPU (% of one core) and memory of the API, website server and MySQL processes, free system memory,
//   MySQL connections (all, and the app's busy ones), the longest-running query, row-lock waits,
//   and how long the API's /health takes to answer (a canary for a blocked event loop or a full DB pool).
// Usage: node loadtest/monitor.mjs --api-port 3100 --web-port 4400 --out loadtest/results/monitor-x.csv
import { execSync, spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({ options: { 'api-port': { type: 'string', default: '3100' }, 'web-port': { type: 'string', default: '4400' }, out: { type: 'string' }, interval: { type: 'string', default: '2' } } });
const require = createRequire(join(import.meta.dirname, '../backend/package.json'));
const mysql = require('mysql2/promise');
const env = Object.fromEntries(
  readFileSync(join(import.meta.dirname, '../backend/.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const pidOn = (port) => {
  const line = execSync('netstat -ano', { encoding: 'utf8' })
    .split(/\r?\n/)
    .find((l) => l.includes('LISTENING') && new RegExp(`:${port}\\s`).test(l));
  return line ? Number(line.trim().split(/\s+/).at(-1)) : null;
};
const apiPid = pidOn(a['api-port']);
const webPid = pidOn(a['web-port']);
// The MySQL server the app uses (there can be more than one on a machine).
const dbPid = pidOn(env.DB_PORT);
// With WEB_WORKERS the website is a main process plus workers: count them all together.
const childrenOf = (pid) =>
  execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Where-Object Name -eq 'node.exe').ProcessId"`, { encoding: 'utf8' })
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
const webPids = webPid ? [webPid, ...childrenOf(webPid)] : [];
console.error(`api pid ${apiPid}, web pids ${webPids.join('+')}, mysqld pid ${dbPid}`);

// One long-lived PowerShell prints a JSON line of process counters per interval (cheaper than one per sample).
const ids = [apiPid, ...webPids, dbPid].filter(Boolean).join(',');
const ps = spawn('powershell', ['-NoProfile', '-Command', `while ($true) { $p = Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { @{ id = $_.Id; cpu = $_.CPU; ws = $_.WorkingSet64 } }; $os = Get-CimInstance Win32_OperatingSystem; $load = [math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue); @{ t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); p = @($p); free = $os.FreePhysicalMemory; load = $load } | ConvertTo-Json -Compress -Depth 3; Start-Sleep -Seconds ${a.interval} }`]);
let lastProc = null;
let latestProc = null;
let buf = '';
ps.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const s = JSON.parse(line);
    if (lastProc) {
      const dt = (s.t - lastProc.t) / 1000;
      const cpu = (id) => {
        const now = s.p.find((x) => x.id === id);
        const before = lastProc.p.find((x) => x.id === id);
        return now && before ? +(((now.cpu - before.cpu) / dt) * 100).toFixed(0) : '';
      };
      const mem = (id) => {
        const now = s.p.find((x) => x.id === id);
        return now ? Math.round(now.ws / 1048576) : '';
      };
      const sum = (f) => webPids.reduce((t, id) => t + (Number(f(id)) || 0), 0);
      latestProc = { apiCpu: cpu(apiPid), apiMem: mem(apiPid), webCpu: sum(cpu), webMem: sum(mem), dbCpu: cpu(dbPid), dbMem: mem(dbPid), freeMb: Math.round(s.free / 1024), machineCpu: s.load };
    }
    lastProc = s;
  }
});

const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const out = a.out ? createWriteStream(a.out) : process.stdout;
const cols = ['time', 'apiCpu', 'apiMem', 'webCpu', 'webMem', 'dbCpu', 'dbMem', 'freeMb', 'machineCpu', 'dbThreads', 'dbRunning', 'appConns', 'appBusy', 'longestQueryS', 'rowLockWaits', 'rowLockMs', 'healthMs', 'healthStatus'];
out.write(cols.join(',') + '\n');
let prevLocks = null;
setInterval(async () => {
  try {
    const [status] = await db.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Innodb_row_lock_waits','Innodb_row_lock_time')");
    const st = Object.fromEntries(status.map((r) => [r.Variable_name, Number(r.Value)]));
    const [plist] = await db.query("SELECT COMMAND, TIME, STATE FROM information_schema.PROCESSLIST WHERE USER = ? AND ID <> CONNECTION_ID()", [env.DB_USER]);
    const busy = plist.filter((r) => r.COMMAND !== 'Sleep');
    const t0 = performance.now();
    let healthStatus = 0;
    try {
      healthStatus = (await fetch(`http://127.0.0.1:${a['api-port']}/api/v1/health`, { signal: AbortSignal.timeout(10_000) })).status;
    } catch {
      healthStatus = 0;
    }
    const healthMs = Math.round(performance.now() - t0);
    const locks = { waits: st.Innodb_row_lock_waits, ms: st.Innodb_row_lock_time };
    const row = {
      time: new Date().toISOString().slice(11, 19),
      ...(latestProc ?? {}),
      dbThreads: st.Threads_connected,
      dbRunning: st.Threads_running,
      appConns: plist.length,
      appBusy: busy.length,
      longestQueryS: busy.length ? Math.max(...busy.map((r) => r.TIME)) : 0,
      rowLockWaits: prevLocks ? locks.waits - prevLocks.waits : 0,
      rowLockMs: prevLocks ? locks.ms - prevLocks.ms : 0,
      healthMs,
      healthStatus,
    };
    prevLocks = locks;
    out.write(cols.map((c) => row[c] ?? '').join(',') + '\n');
  } catch (err) {
    console.error('sample failed', err.message);
  }
}, Number(a.interval) * 1000);

const stop = () => {
  ps.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

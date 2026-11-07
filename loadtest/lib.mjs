// Shared pieces of the load tester: a virtual visitor (cookies, security token, own IP address),
// timing of every request, and the statistics printed in the reports.
import { performance } from 'node:perf_hooks';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (min, max) => min + Math.random() * (max - min);
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Think time between actions, scaled by THINK (1 = realistic human pauses, 0.25 = four times faster). */
export const think = (minS, maxS, scale) => sleep(rand(minS, maxS) * 1000 * scale);

/** Every request lands here: label, status, time, and when it happened. */
export class Recorder {
  constructor() {
    this.samples = [];
    this.stage = 'start';
    this.events = [];
  }
  setStage(name) {
    this.stage = name;
    this.events.push({ t: Date.now(), stage: name });
  }
  add(s) {
    this.samples.push({ ...s, stage: this.stage, t: Date.now() });
  }
}

let ipCounter = 0;
/** A unique, made-up public address per visitor (100.64.0.0/10 is reserved, never a real person). */
export function nextIp() {
  const n = ipCounter++;
  return `100.${64 + ((n >> 16) & 63)}.${(n >> 8) & 255}.${n & 255}`;
}

/** One simulated visitor: keeps cookies like a browser and sends the security token Angular would send. */
export class Visitor {
  constructor(base, recorder, { timeoutMs = 30_000, slow = false } = {}) {
    this.base = base;
    this.rec = recorder;
    this.ip = nextIp();
    this.cookies = new Map();
    this.timeoutMs = timeoutMs;
    // A slow connection: extra delay before each request and while reading the response.
    this.slow = slow;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  keepCookies(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * Sends a request and records it. `label` groups requests in the report (e.g. "submit").
   * Returns { status, ok, json, text, ms }; network errors and timeouts come back as status 0.
   */
  async request(label, method, path, { json, form, expect } = {}) {
    if (this.slow) await sleep(rand(150, 400));
    const headers = { 'x-forwarded-for': this.ip, 'user-agent': 'school-site-loadtest/1.0', accept: 'application/json, text/html' };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const token = this.cookies.get('XSRF-TOKEN');
    if (token && method !== 'GET') headers['x-xsrf-token'] = decodeURIComponent(token);
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) body = form;

    const started = performance.now();
    let status = 0;
    let text = '';
    let error = null;
    try {
      const res = await fetch(this.base + path, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      status = res.status;
      this.keepCookies(res);
      text = await res.text();
      if (this.slow) await sleep(rand(100, 300));
    } catch (err) {
      error = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.name ?? 'error');
    }
    const ms = performance.now() - started;
    const ok = expect ? expect.includes(status) : status >= 200 && status < 400;
    // For failures, keep the start of the answer so the report can say why.
    this.rec.add({ label, status, ms, ok, error, bytes: text.length, detail: ok ? undefined : text.slice(0, 160) });
    let parsed = null;
    if (text && text[0] === '{') {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* not JSON */
      }
    }
    return { status, ok, json: parsed, text, ms, error };
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);

/** Count, throughput, error rate and latency percentiles for a set of samples. */
export function summarise(samples, seconds) {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok);
  const byStatus = {};
  for (const s of samples) {
    const k = s.error ?? s.status;
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  return {
    requests: samples.length,
    rps: seconds ? +(samples.length / seconds).toFixed(2) : null,
    errorRate: samples.length ? +((errors.length / samples.length) * 100).toFixed(2) : 0,
    avg: ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1) : 0,
    p50: +pct(ms, 50).toFixed(1),
    p90: +pct(ms, 90).toFixed(1),
    p95: +pct(ms, 95).toFixed(1),
    p99: +pct(ms, 99).toFixed(1),
    max: +(ms.at(-1) ?? 0).toFixed(1),
    byStatus,
  };
}

/** Per stage and per request label. */
export function report(rec) {
  const stages = [...new Set(rec.samples.map((s) => s.stage))];
  const out = [];
  for (const stage of stages) {
    const ss = rec.samples.filter((s) => s.stage === stage);
    const t0 = Math.min(...ss.map((s) => s.t));
    const t1 = Math.max(...ss.map((s) => s.t));
    const seconds = Math.max(1, (t1 - t0) / 1000);
    const labels = [...new Set(ss.map((s) => s.label))].sort();
    out.push({
      stage,
      seconds: +seconds.toFixed(1),
      all: summarise(ss, seconds),
      labels: Object.fromEntries(labels.map((l) => [l, summarise(ss.filter((s) => s.label === l), seconds)])),
    });
  }
  return out;
}

export function printReport(rows) {
  for (const r of rows) {
    const a = r.all;
    console.log(`\n== ${r.stage}  (${r.seconds}s)  ${a.requests} req  ${a.rps} req/s  errors ${a.errorRate}%  avg ${a.avg}  p50 ${a.p50}  p90 ${a.p90}  p95 ${a.p95}  p99 ${a.p99}  max ${a.max} ms`);
    for (const [label, s] of Object.entries(r.labels)) {
      console.log(
        `   ${label.padEnd(22)} n=${String(s.requests).padStart(5)}  err ${String(s.errorRate).padStart(5)}%  avg ${String(s.avg).padStart(7)}  p50 ${String(s.p50).padStart(7)}  p95 ${String(s.p95).padStart(7)}  p99 ${String(s.p99).padStart(7)}  max ${String(s.max).padStart(7)}  ${JSON.stringify(s.byStatus)}`,
      );
    }
  }
}

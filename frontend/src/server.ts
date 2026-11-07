import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import cluster from 'node:cluster';
import { request as httpRequest } from 'node:http';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { VISITOR_IP_HEADER, WEBSITE_KEY_HEADER } from './app/core/api-url.interceptor';

/**
 * Production web server: serves the built site, renders public pages on the server,
 * passes /api and /media through to the Node.js API, and adds security headers.
 */

const browserDistFolder = join(import.meta.dirname, '../browser');
const apiOrigin = new URL(process.env['API_ORIGIN'] || 'http://localhost:3000');
const production = process.env['NODE_ENV'] === 'production';
const websiteServerSecret = process.env['WEBSITE_SERVER_SECRET'] ?? '';
if (production && websiteServerSecret.length < 32) {
  console.error('WEBSITE_SERVER_SECRET must be set (32+ random characters, the same as in the API settings). See README "Going live".');
  process.exit(1);
}

/**
 * Angular's build puts a few fixed inline scripts in the page (event replay, critical CSS loader).
 * Allow exactly those by their SHA-256 hash; any other inline script needs the per-request nonce.
 */
function buildScriptHashes(): string[] {
  const files = [join(import.meta.dirname, 'index.server.html'), join(browserDistFolder, 'index.csr.html')];
  const hashes = new Set<string>();
  for (const file of files.filter((f) => existsSync(f))) {
    for (const [, attrs, body] of readFileSync(file, 'utf8').matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/src=|application\/json/.test(attrs) || !body.trim()) continue;
      hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
  }
  return [...hashes];
}
const scriptHashes = buildScriptHashes();

const app = express();
const angularApp = new AngularNodeAppEngine();

app.disable('x-powered-by');
if (process.env['TRUST_PROXY']) app.set('trust proxy', Number(process.env['TRUST_PROXY']) || process.env['TRUST_PROXY']);

/** A fresh random value per request; only inline scripts carrying it may run. */
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals['cspNonce'] = randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...scriptHashes, (_req, res) => `'nonce-${(res as Response).locals['cspNonce']}'`],
        // Angular adds component styles at runtime; inline styles cannot run code.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        // Only the click-to-play video players and the map may be embedded.
        frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.openstreetmap.org'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(production ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Allows embedding YouTube/Vimeo players, which do not send CORP headers.
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});

/**
 * The visitor's address as this server sees it (with TRUST_PROXY, the address Nginx reports), sent to the API
 * with the shared WEBSITE_SERVER_SECRET. Without it the API would see this server's address for every visitor,
 * so they would all share one set of rate limits. The same headers coming from a browser are thrown away.
 */
function visitorHeaders(req: Request): Record<string, string> {
  return websiteServerSecret && req.ip ? { [VISITOR_IP_HEADER]: req.ip, [WEBSITE_KEY_HEADER]: websiteServerSecret } : {};
}
function withoutVisitorHeaders(headers: Request['headers']) {
  const { [VISITOR_IP_HEADER]: _ip, [WEBSITE_KEY_HEADER]: _key, ...rest } = headers;
  return rest;
}

/** Passes /api and /media to the API server unchanged (streams bodies, so uploads work). */
function proxyToApi(req: Request, res: Response) {
  const upstream = httpRequest(
    {
      protocol: apiOrigin.protocol,
      hostname: apiOrigin.hostname,
      port: apiOrigin.port,
      method: req.method,
      path: req.originalUrl,
      headers: {
        ...withoutVisitorHeaders(req.headers),
        host: apiOrigin.host,
        'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
        'x-forwarded-proto': req.protocol,
        ...visitorHeaders(req),
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ message: 'The service is temporarily unavailable. Please try again shortly.' });
    else res.end();
  });
  req.pipe(upstream);
}
app.use('/api', proxyToApi);
app.use('/media', proxyToApi);

app.use(compression());

/** Built files have unique names, so they can be cached for a year. */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    immutable: true,
    index: false,
    redirect: false,
  }),
);

/** Site languages from the API, refreshed every few minutes. */
let siteLanguages: { codes: string[]; at: number } = { codes: [], at: 0 };
async function languageCodes(): Promise<string[]> {
  if (Date.now() - siteLanguages.at < 5 * 60_000) return siteLanguages.codes;
  try {
    const res = await fetch(new URL('/api/v1/public/site?locale=en', apiOrigin));
    const data = (await res.json()) as { languages?: { code: string }[] };
    siteLanguages = { codes: (data.languages ?? []).map((l) => l.code), at: Date.now() };
  } catch {
    siteLanguages = { codes: siteLanguages.codes, at: Date.now() - 4 * 60_000 }; // retry in a minute
  }
  return siteLanguages.codes;
}

/** Same list as APP_ROUTES in core/site.ts: pages that never get a language prefix. */
const APP_ROUTES = /^\/(admin|api|media|apply|preview|portal|login|assets|timetable|blog)(\/|$|[?#])/;

/**
 * A page without a language in its address (e.g. "/admissions"):
 * - a returning visitor who chose another language (site_lang cookie) goes back to it;
 * - on a first visit, if the browser asks for a site language other than English, the visitor goes
 *   to that language and it is remembered.
 * English, or a language the site does not offer, stays on the address as it is.
 */
app.get(/.*/, async (req, res, next) => {
  if (APP_ROUTES.test(req.path) || /^\/[a-z]{2}(\/|$)/.test(req.path)) return next();
  const saved = /(?:^|;\s*)site_lang=([a-z]{2})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
  const hasCookie = /(?:^|;\s*)site_lang=/.test(req.headers.cookie ?? '');
  const preferred = hasCookie ? [] : req.acceptsLanguages().map((tag) => tag.slice(0, 2).toLowerCase());
  if (saved === 'en' || (hasCookie && !saved) || (!saved && (!preferred.length || preferred[0] === '*'))) return next();
  const codes = await languageCodes();
  const match = saved ? (codes.includes(saved) ? saved : null) : (preferred.find((code) => codes.includes(code)) ?? null);
  if (!match || match === 'en') return next();
  const query = req.originalUrl.slice(req.path.length);
  res.setHeader('Vary', 'Accept-Language, Cookie');
  if (!saved) res.cookie('site_lang', match, { path: '/', maxAge: 31_536_000_000, sameSite: 'lax' });
  res.redirect(302, `/${match}${req.path === '/' ? '' : req.path}${query}`);
});

/** A staff sign-in link: /admin/<token>, where the token is five groups of five letters and digits. */
const SIGN_IN_LINK = /^\/admin\/([0-9A-Za-z]{5}(?:-?[0-9A-Za-z]{5}){4})\/?$/;

/** Calls the API on behalf of a page request, with the visitor's address and browser. */
function apiCall(req: Request, path: string, init: { method?: string; cookie?: string; body?: unknown; csrf?: boolean } = {}) {
  const csrf = init.csrf ? randomBytes(32).toString('base64url') : null;
  const cookie = [init.cookie, csrf && `XSRF-TOKEN=${csrf}`].filter(Boolean).join('; ');
  return fetch(new URL(path, apiOrigin), {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-xsrf-token': csrf } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      'user-agent': req.headers['user-agent'] ?? '',
      'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
      'x-forwarded-proto': req.protocol,
      ...visitorHeaders(req),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
}

/**
 * Who may load an /admin page at all:
 * - someone with a staff session (signed in, or part-way through two-step login);
 * - someone opening a valid sign-in link, /admin/<token>. The API checks the token and sets a short
 *   pass cookie for the sign-in, which is passed on to the browser here.
 * Everyone else gets "page not found", with a real 404 status, so /admin does not reveal a sign-in page.
 * The browser app applies the same rules, and the API refuses staff sign-in without the pass anyway.
 */
async function adminPageAllowed(req: Request, res: Response): Promise<boolean> {
  const cookies = req.headers.cookie ?? '';
  const token = SIGN_IN_LINK.exec(req.path)?.[1];
  // The session cookie only, so the API knows who (if anyone) is signed in when it checks a link.
  const sid = /(?:^|;\s*)(sid=[^;]*)/.exec(cookies)?.[1];
  try {
    if (sid) {
      const me = (await (await apiCall(req, '/api/v1/auth/me', { cookie: sid })).json()) as {
        user: { permissions?: string[] } | null;
      };
      // Signed-in staff can use the portal, but another person's sign-in link is still "not found".
      if (me.user?.permissions?.includes('admin.access') && !token) return true;
    }
    if (!token) return false;
    const check = await apiCall(req, '/api/v1/auth/portal-access', {
      method: 'POST',
      body: { key: token },
      csrf: true,
      cookie: sid,
    });
    if (!check.ok) return false;
    const pass = check.headers.getSetCookie().filter((c) => c.startsWith('portal_pass='));
    if (pass.length) res.append('Set-Cookie', pass);
    return true;
  } catch {
    return false;
  }
}

/** Everything else: render the Angular app (public pages on the server, admin and applicant pages in the browser). */
app.use(async (req, res, next) => {
  // Pages differ by the browser's language on a first visit, so caches must not share them across languages.
  res.setHeader('Vary', 'Accept-Language, Cookie');
  try {
    const isAdmin = /^\/admin(\/|$)/.test(req.path);
    const allowed = !isAdmin || (await adminPageAllowed(req, res));
    if (isAdmin) res.setHeader('Cache-Control', 'no-store');
    // visitorHeaders: so the API calls made while rendering the page count against this visitor, not this server.
    const response = await angularApp.handle(req, { cspNonce: res.locals['cspNonce'], apiHeaders: visitorHeaders(req) });
    if (!response) return next();
    // The browser app shows the site's "page not found" for the same addresses.
    await writeResponseToNodeResponse(
      allowed ? response : new Response(response.body, { status: 404, headers: response.headers }),
      res,
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Rendering a page takes about 40 ms of CPU and one Node process uses one core, so under load
 * visitors queue behind each other. WEB_WORKERS=<n> (or "auto": one per core, minus one for the API)
 * runs n processes sharing the port. Under PM2, use its own cluster mode instead (pm_id is then set).
 */
function workerCount(): number {
  const setting = (process.env['WEB_WORKERS'] ?? '1').trim().toLowerCase();
  if (setting === 'auto') return Math.max(1, availableParallelism() - 1);
  const n = Number.parseInt(setting, 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, 64) : 1;
}

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  const workers = process.env['pm_id'] ? 1 : workerCount();
  if (workers > 1 && cluster.isPrimary) {
    for (let i = 0; i < workers; i++) cluster.fork();
    // A worker that crashes is replaced, unless it dies straight away (a start-up error), which would loop.
    const started = Date.now();
    cluster.on('exit', (worker, code, signal) => {
      console.error(`Website worker ${worker.process.pid} stopped (${signal ?? code}).`);
      if (Date.now() - started > 10_000) cluster.fork();
    });
    console.log(`Website: ${workers} workers on port ${port} (API: ${apiOrigin.origin})`);
  } else {
    app.listen(port, (error) => {
      if (error) throw error;
      if (cluster.isPrimary) console.log(`Website listening on http://localhost:${port} (API: ${apiOrigin.origin})`);
    });
  }
}

/** Request handler used by the Angular CLI (for dev-server and during build). */
export const reqHandler = createNodeRequestHandler(app);

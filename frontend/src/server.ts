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
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

/**
 * Production web server: serves the built site, renders public pages on the server,
 * passes /api and /media through to the Node.js API, and adds security headers.
 */

const browserDistFolder = join(import.meta.dirname, '../browser');
const apiOrigin = new URL(process.env['API_ORIGIN'] || 'http://localhost:3000');
const production = process.env['NODE_ENV'] === 'production';

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
        ...req.headers,
        host: apiOrigin.host,
        'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
        'x-forwarded-proto': req.protocol,
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

/** Everything else: render the Angular app (public pages on the server, admin and applicant pages in the browser). */
app.use((req, res, next) => {
  // Pages differ by the browser's language on a first visit, so caches must not share them across languages.
  res.setHeader('Vary', 'Accept-Language, Cookie');
  angularApp
    .handle(req, { cspNonce: res.locals['cspNonce'] })
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) throw error;
    console.log(`Website listening on http://localhost:${port} (API: ${apiOrigin.origin})`);
  });
}

/** Request handler used by the Angular CLI (for dev-server and during build). */
export const reqHandler = createNodeRequestHandler(app);

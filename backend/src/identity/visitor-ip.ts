import type { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/** The visitor's address, as worked out by the website server. */
export const VISITOR_IP_HEADER = 'x-visitor-ip';
/** Proves the request came from the website server: the shared WEBSITE_SERVER_SECRET. */
export const WEBSITE_KEY_HEADER = 'x-website-server-key';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Visitors reach the API through the website server (and usually Nginx in front of that), and when the
 * website server renders a page it calls the API itself. Without help the API would see the website
 * server's address for everyone, so sign-in limits, rate limits and audit logs would treat all visitors as one.
 *
 * The website server sends the real visitor address with the shared secret. Only when the secret matches
 * does `req.ip` become that address; otherwise the headers are dropped and `req.ip` keeps its normal value
 * (from TRUST_PROXY), so nobody can choose their own address by sending the header themselves.
 */
export function visitorIp(secret = process.env.WEBSITE_SERVER_SECRET ?? '') {
  const expected = secret ? digest(secret) : null;
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.headers[WEBSITE_KEY_HEADER];
    const ip = req.headers[VISITOR_IP_HEADER];
    delete req.headers[WEBSITE_KEY_HEADER];
    delete req.headers[VISITOR_IP_HEADER];
    const address = typeof ip === 'string' ? ip.trim() : '';
    if (
      expected &&
      typeof key === 'string' &&
      isIP(address) &&
      timingSafeEqual(digest(key), expected)
    ) {
      Object.defineProperty(req, 'ip', {
        value: address,
        configurable: true,
        enumerable: true,
      });
    }
    next();
  };
}

import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { VISITOR_IP_HEADER, WEBSITE_KEY_HEADER, visitorIp } from './visitor-ip.js';

const SECRET = 'a'.repeat(40);

function run(headers: Record<string, string>, secret = SECRET) {
  const req = { headers: { ...headers }, ip: '127.0.0.1' } as unknown as Request;
  let called = false;
  visitorIp(secret)(req, {} as Response, () => (called = true));
  return { req, called };
}

describe('visitorIp', () => {
  it('uses the visitor address sent with the right secret', () => {
    const { req, called } = run({ [VISITOR_IP_HEADER]: '41.90.1.2', [WEBSITE_KEY_HEADER]: SECRET });
    expect(called).toBe(true);
    expect(req.ip).toBe('41.90.1.2');
    expect(req.headers[WEBSITE_KEY_HEADER]).toBeUndefined();
  });

  it('ignores a wrong secret and removes the headers', () => {
    const { req } = run({ [VISITOR_IP_HEADER]: '41.90.1.2', [WEBSITE_KEY_HEADER]: 'guess' });
    expect(req.ip).toBe('127.0.0.1');
    expect(req.headers[VISITOR_IP_HEADER]).toBeUndefined();
  });

  it('ignores the header when no secret is configured', () => {
    const { req } = run({ [VISITOR_IP_HEADER]: '41.90.1.2', [WEBSITE_KEY_HEADER]: '' }, '');
    expect(req.ip).toBe('127.0.0.1');
  });

  it('ignores something that is not an address', () => {
    const { req } = run({ [VISITOR_IP_HEADER]: 'not-an-ip', [WEBSITE_KEY_HEADER]: SECRET });
    expect(req.ip).toBe('127.0.0.1');
  });
});

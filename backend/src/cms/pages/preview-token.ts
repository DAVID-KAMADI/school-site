import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, expiring links that let someone without an account view an unpublished revision.
 * Token = base64url(payload).base64url(hmac-sha256(payload)).
 */
interface PreviewPayload {
  pageId: number;
  revisionId: number;
  expiresAt: number;
}

function secret(): string {
  const value = process.env.PREVIEW_LINK_SECRET;
  if (!value || value.length < 32)
    throw new Error(
      'PREVIEW_LINK_SECRET must be set (at least 32 characters).',
    );
  return value;
}

const sign = (data: string) =>
  createHmac('sha256', secret()).update(data).digest('base64url');

export function createPreviewToken(payload: PreviewPayload): string {
  const data = Buffer.from(
    JSON.stringify([payload.pageId, payload.revisionId, payload.expiresAt]),
  ).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function readPreviewToken(
  token: string,
  now = Date.now(),
): PreviewPayload | null {
  const [data, mac] = token.split('.');
  if (!data || !mac) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const [pageId, revisionId, expiresAt] = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf8'),
    ) as number[];
    if (
      ![pageId, revisionId, expiresAt].every(Number.isInteger) ||
      expiresAt < now
    )
      return null;
    return { pageId, revisionId, expiresAt };
  } catch {
    return null;
  }
}

import type { Response } from 'express';
import type { ReadStream } from 'node:fs';

/** Streams a private file with headers that stop caching and content sniffing. */
export function sendPrivateFile(
  res: Response,
  file: { stream: ReadStream; mimeType: string; name: string },
) {
  const safeName =
    file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'document';
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  file.stream.on('error', () => res.status(404).end());
  file.stream.pipe(res);
}

/** Sends a generated PDF to open in the browser (and save with a sensible name). */
export function sendPdf(res: Response, file: { pdf: Buffer; name: string }) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${file.name.replace(/[^\w.\-]+/g, '_')}"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.pdf);
}

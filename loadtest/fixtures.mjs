// Synthetic test documents (no real person's data): two PDFs and a passport-style photo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'fixtures');
const require = createRequire(join(import.meta.dirname, '../backend/package.json'));

/** A small but valid PDF padded to about `kb` kilobytes (the API checks the file starts with %PDF). */
function pdf(title, kb) {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 72 760 Td (${title}) Tj ET\nendstream endobj\n`;
  const pad = `% load test padding ${'x'.repeat(70)}\n`;
  let out = body;
  while (out.length < kb * 1024) out += pad;
  return Buffer.from(out + 'trailer<</Root 1 0 R>>\n%%EOF\n');
}

export async function ensureFixtures() {
  mkdirSync(dir, { recursive: true });
  const files = {
    id: join(dir, 'national-id.pdf'),
    kcse: join(dir, 'kcse-slip.pdf'),
    photo: join(dir, 'passport-photo.jpg'),
  };
  if (!existsSync(files.id)) writeFileSync(files.id, pdf('SYNTHETIC ID - LOAD TEST', 180));
  if (!existsSync(files.kcse)) writeFileSync(files.kcse, pdf('SYNTHETIC KCSE SLIP - LOAD TEST', 250));
  if (!existsSync(files.photo)) {
    // A phone-camera sized photo (1200x1600) so the server's photo re-encoding does real work.
    const sharp = require('sharp');
    const w = 1200, h = 1600;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[i] = (x * 255) / w;
        raw[i + 1] = (y * 255) / h;
        raw[i + 2] = (Math.sin(x / 37) * Math.cos(y / 23) * 127 + 128) | 0;
      }
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toFile(files.photo);
  }
  return {
    id: { name: 'national-id.pdf', type: 'application/pdf', data: readFileSync(files.id) },
    kcse: { name: 'kcse-slip.pdf', type: 'application/pdf', data: readFileSync(files.kcse) },
    photo: { name: 'passport-photo.jpg', type: 'image/jpeg', data: readFileSync(files.photo) },
  };
}

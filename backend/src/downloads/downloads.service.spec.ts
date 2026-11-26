import { describe, expect, it } from 'vitest';
import type { MediaView } from '../cms/media/media.service.js';
import { categorySchema, downloadSchema, fileOf } from './downloads.service.js';

const base = { categoryId: 1, title: 'Supply of lab equipment', mediaId: 7 };

describe('downloads', () => {
  it('fills in today as the posted date and no deadline', () => {
    const r = downloadSchema.parse(base);
    expect(r.publishedOn).toBe(new Date().toISOString().slice(0, 10));
    expect(r.closesAt).toBeNull();
    expect(r.isPublished).toBe(true);
    expect(r.reference).toBeNull();
  });

  it('reads a closing time with its time zone', () => {
    const r = downloadSchema.parse({ ...base, closesAt: '2026-12-12T10:00:00+03:00' });
    expect(r.closesAt?.toISOString()).toBe('2026-12-12T07:00:00.000Z');
  });

  it('refuses a missing file, a vague deadline and extra fields', () => {
    expect(downloadSchema.safeParse({ ...base, mediaId: null }).success).toBe(false);
    expect(downloadSchema.safeParse({ ...base, closesAt: 'next friday' }).success).toBe(false);
    expect(downloadSchema.parse({ ...base, isAdmin: true } as never)).not.toHaveProperty('isAdmin');
  });

  it('category addresses are simple', () => {
    expect(categorySchema.safeParse({ name: 'Tenders', slug: 'Tenders 2026!' }).success).toBe(false);
    expect(categorySchema.parse({ name: 'Tenders', slug: 'TENDERS-2026' }).slug).toBe('tenders-2026');
  });

  it('gives the file a tidy name and a plain type', () => {
    const m = { url: '/media/2026/11/0b1c.pdf', kind: 'document', sizeBytes: 2048 } as MediaView;
    expect(fileOf('Supply & Delivery: Lab Equipment (RCI/T/004)', m)).toEqual({
      url: '/media/2026/11/0b1c.pdf',
      saveAs: 'supply-and-delivery-lab-equipment-rci-t-004.pdf',
      type: 'PDF',
      sizeBytes: 2048,
    });
    expect(fileOf('Staff list', { ...m, url: '/media/x.xlsx' }).type).toBe('Excel');
  });
});

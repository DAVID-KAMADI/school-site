import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { z } from 'zod';
import type { SiteSetting } from '../entities/site-setting.entity.js';

/** The small label, heading and introduction at the top of the Gallery and Our people pages. */
export interface PageIntro {
  eyebrow: string;
  title: string;
  intro: string;
}

export const pageIntroSchema = z.object({
  eyebrow: z.string().trim().max(60).default(''),
  title: z.string().trim().min(2).max(80),
  intro: z.string().trim().max(400).default(''),
});

/** Reads a page heading setting ("gallery.page", "staff.page"), falling back to `fallback`. */
export async function readPageIntro(
  settings: Repository<SiteSetting>,
  key: string,
  fallback: PageIntro,
): Promise<PageIntro> {
  const row = await settings.findOneBy({ key });
  const r = pageIntroSchema.safeParse(row?.value);
  return r.success ? r.data : fallback;
}

export async function savePageIntro(
  settings: Repository<SiteSetting>,
  key: string,
  description: string,
  body: unknown,
  userId: number,
): Promise<PageIntro> {
  const r = pageIntroSchema.safeParse(body);
  if (!r.success)
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '),
    );
  await settings.save({
    key,
    value: r.data,
    groupName: 'showcase',
    description,
    updatedBy: { id: userId },
  });
  return r.data;
}

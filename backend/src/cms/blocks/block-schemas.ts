import { z } from 'zod';
import { sanitizeRichText } from './rich-text.js';

/**
 * Every content block type editors can place on a page, with the fields they can edit.
 * The server validates and cleans block content against these schemas on every save,
 * so the front end can trust the shape of what it renders.
 */

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) =>
  z.string().trim().min(1, 'Required').max(max);
const richText = z.string().max(50_000).transform(sanitizeRichText);
const mediaId = z.number().int().positive();

/** Internal path, https link, email or phone. Blocks javascript: and other unsafe schemes. */
export const safeHref = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) =>
      /^\/(?!\/)/.test(v) ||
      /^https?:\/\//i.test(v) ||
      /^mailto:/i.test(v) ||
      /^tel:/i.test(v) ||
      /^#[\w-]+$/.test(v),
    {
      message:
        'Use a site path (/about), a full https:// link, mailto: or tel:',
    },
  );

const link = z.object({
  label: requiredText(60),
  href: safeHref,
  openInNewTab: z.boolean().default(false),
});
const background = z
  .enum(['default', 'light', 'dark', 'accent'])
  .default('default');

/** Only these video hosts may be embedded. */
const VIDEO_HOSTS =
  /^https:\/\/(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|player\.vimeo\.com)\//i;

export const BLOCK_SCHEMAS = {
  hero: z.object({
    /** Small label above the headline, e.g. "September intake now open". */
    eyebrow: text(80).default(''),
    heading: requiredText(120),
    text: text(400).default(''),
    mediaId: mediaId.nullable().default(null),
    videoUrl: z
      .string()
      .trim()
      .regex(VIDEO_HOSTS, 'YouTube or Vimeo links only')
      .nullable()
      .default(null),
    buttons: z.array(link).max(3).default([]),
    align: z.enum(['left', 'center']).default('left'),
    /** Extra photos that crossfade after the main photo (slideshow). */
    slides: z.array(mediaId).max(6).default([]),
    /** Uploaded MP4/WebM that plays muted behind the headline. */
    videoId: mediaId.nullable().default(null),
    /** What visitors see first when both a video and photos are set; they can switch either way. */
    startWith: z.enum(['video', 'slideshow']).default('video'),
    height: z.enum(['full', 'medium', 'short']).default('full'),
  }),
  rich_text: z.object({ html: richText, background }),
  image: z.object({
    mediaId,
    caption: text(300).default(''),
    size: z.enum(['content', 'wide', 'full']).default('content'),
  }),
  image_text: z.object({
    eyebrow: text(80).default(''),
    heading: text(120).default(''),
    html: richText,
    mediaId,
    imagePosition: z.enum(['left', 'right']).default('left'),
    button: link.nullable().default(null),
    background,
  }),
  gallery: z.object({
    heading: text(120).default(''),
    items: z
      .array(z.object({ mediaId, caption: text(300).default('') }))
      .min(1)
      .max(60),
  }),
  cards: z.object({
    eyebrow: text(80).default(''),
    heading: text(120).default(''),
    intro: text(400).default(''),
    columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
    /** standard: photo above text; overlay: text over the photo; tiles: compact quick links. */
    variant: z.enum(['standard', 'overlay', 'tiles']).default('standard'),
    items: z
      .array(
        z.object({
          title: requiredText(120),
          text: text(400).default(''),
          mediaId: mediaId.nullable().default(null),
          link: link.nullable().default(null),
        }),
      )
      .min(1)
      .max(24),
    background,
  }),
  stats: z.object({
    eyebrow: text(80).default(''),
    heading: text(120).default(''),
    items: z
      .array(
        z.object({
          value: requiredText(20),
          label: requiredText(80),
          context: text(160).default(''),
        }),
      )
      .min(1)
      .max(8),
    background,
  }),
  timeline: z.object({
    heading: text(120).default(''),
    items: z
      .array(
        z.object({
          date: requiredText(40),
          title: requiredText(120),
          text: text(400).default(''),
        }),
      )
      .min(1)
      .max(50),
  }),
  cta: z.object({
    heading: requiredText(120),
    text: text(300).default(''),
    buttons: z.array(link).min(1).max(2),
    background: z.enum(['light', 'dark', 'accent']).default('accent'),
  }),
  faq: z.object({
    heading: text(120).default(''),
    items: z
      .array(z.object({ question: requiredText(200), answerHtml: richText }))
      .min(1)
      .max(50),
  }),
  tabs: z.object({
    items: z
      .array(z.object({ title: requiredText(60), html: richText }))
      .min(2)
      .max(8),
  }),
  testimonial: z.object({
    quote: requiredText(600),
    name: requiredText(100),
    role: text(120).default(''),
    mediaId: mediaId.nullable().default(null),
  }),
  video: z.object({
    url: z.string().trim().regex(VIDEO_HOSTS, 'YouTube or Vimeo links only'),
    eyebrow: text(80).default(''),
    /** Shown above the video (or beside it, with the text). */
    heading: text(120).default(''),
    /** Optional text beside the video when it sits left or right. */
    html: richText.default(''),
    /** "center": the video on its own; "left"/"right": the video beside the text, like Image with text. */
    videoPosition: z.enum(['center', 'left', 'right']).default('center'),
    button: link.nullable().default(null),
    /** Name read out by screen readers; the heading is used when empty. */
    title: text(120).default(''),
    caption: text(300).default(''),
    background,
  }),
  map: z.object({
    label: text(120).default(''),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    zoom: z.number().int().min(3).max(20).default(16),
  }),
  downloads: z.object({
    heading: text(120).default(''),
    items: z
      .array(z.object({ mediaId, title: requiredText(160) }))
      .min(1)
      .max(100),
  }),
  contact_form: z.object({
    heading: text(120).default(''),
    intro: text(400).default(''),
    /** Which inbox receives submissions, chosen from site settings later. */
    recipient: z
      .enum(['general', 'admissions', 'finance', 'library', 'hostels'])
      .default('general'),
  }),
  /** Programmes from Admissions setup, in tabs by level, optionally with a Short courses tab. */
  programmes: z.object({
    eyebrow: text(80).default(''),
    heading: text(120).default(''),
    intro: text(400).default(''),
    /** Levels to show; empty shows every level that has programmes. */
    levels: z
      .array(
        z.enum([
          'certificate',
          'diploma',
          'degree',
          'postgraduate',
          'short_course',
        ]),
      )
      .max(5)
      .default([]),
    showShortCourses: z.boolean().default(true),
    /** Button on each short course, e.g. "Enquire" to the contact page. */
    enquiryLink: link.nullable().default(null),
    background,
  }),
  /** Short courses from the admin, as cards. */
  short_courses: z.object({
    eyebrow: text(80).default(''),
    heading: text(120).default(''),
    intro: text(400).default(''),
    /** Only courses in this category; empty shows all. */
    category: text(100).default(''),
    enquiryLink: link.nullable().default(null),
    limit: z.number().int().min(1).max(60).default(24),
    background,
  }),
  child_pages: z.object({
    heading: text(120).default(''),
    style: z.enum(['cards', 'list']).default('cards'),
    limit: z.number().int().min(1).max(50).default(12),
  }),
  divider: z.object({}),
  spacer: z.object({ size: z.enum(['sm', 'md', 'lg']).default('md') }),
} as const;

export type BlockType = keyof typeof BLOCK_SCHEMAS;
export const BLOCK_TYPES = Object.keys(BLOCK_SCHEMAS) as BlockType[];

export interface ValidBlock {
  type: BlockType;
  isHidden: boolean;
  content: Record<string, unknown>;
}

export class BlockValidationError extends Error {
  constructor(
    public readonly issues: {
      block: number;
      type: string;
      path: string;
      message: string;
    }[],
  ) {
    super('Some blocks have invalid content.');
  }
}

/** Validates and cleans an ordered list of blocks; throws BlockValidationError listing every problem. */
export function validateBlocks(
  input: { type: string; isHidden?: boolean; content: unknown }[],
): ValidBlock[] {
  const issues: BlockValidationError['issues'] = [];
  const out: ValidBlock[] = [];
  input.forEach((block, index) => {
    const schema = BLOCK_SCHEMAS[block.type as BlockType];
    if (!schema) {
      issues.push({
        block: index,
        type: block.type,
        path: 'type',
        message: `Unknown block type "${block.type}"`,
      });
      return;
    }
    const parsed = schema.safeParse(block.content ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          block: index,
          type: block.type,
          path: issue.path.join('.'),
          message: issue.message,
        });
      }
      return;
    }
    out.push({
      type: block.type as BlockType,
      isHidden: block.isHidden ?? false,
      content: parsed.data as Record<string, unknown>,
    });
  });
  if (issues.length) throw new BlockValidationError(issues);
  return out;
}

/** Fields that hold a single media id. */
const MEDIA_ID_FIELDS = new Set(['mediaId', 'videoId']);
/** Fields that hold a list of media ids rather than objects with a mediaId. */
const MEDIA_ID_LISTS = new Set(['slides']);

/** Every media id referenced anywhere in a block's content, with the field path (for "where used"). */
export function collectMediaRefs(
  content: unknown,
  path = 'content',
): { mediaId: number; fieldPath: string }[] {
  if (Array.isArray(content))
    return content.flatMap((item, i) => collectMediaRefs(item, `${path}.${i}`));
  if (content && typeof content === 'object') {
    return Object.entries(content).flatMap(([key, value]) => {
      if (MEDIA_ID_FIELDS.has(key) && typeof value === 'number')
        return [{ mediaId: value, fieldPath: `${path}.${key}` }];
      if (MEDIA_ID_LISTS.has(key) && Array.isArray(value)) {
        return value
          .map((id, i) => ({
            mediaId: id as number,
            fieldPath: `${path}.${key}.${i}`,
          }))
          .filter((r) => typeof r.mediaId === 'number');
      }
      return collectMediaRefs(value, `${path}.${key}`);
    });
  }
  return [];
}

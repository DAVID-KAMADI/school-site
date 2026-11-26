import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Site colours (Admin → Site colours), kept in site_settings "theme.colors" (group "theme").
 * The website works out every other shade from these four (frontend core/theme.ts).
 */
export const THEME_KEY = 'theme.colors';

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colours are written like #0033a0.')
  .transform((v) => v.toLowerCase());

export const themeSchema = z
  .object({
    primary: hex,
    action: hex,
    accent: hex,
    footer: z.union([hex, z.literal('')]).default(''),
  })
  .strict();

export type ThemeColors = z.infer<typeof themeSchema>;

export const DEFAULT_THEME: ThemeColors = {
  primary: '#0033a0',
  action: '#0345bf',
  accent: '#ef6d00',
  footer: '#001a5c',
};

const MIN_CONTRAST = 4.5;

const channels = (h: string) =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function luminance(h: string) {
  const [r, g, b] = channels(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio of a colour against white. */
export const contrastWithWhite = (h: string) => 1.05 / (luminance(h) + 0.05);

const darker = (h: string, amount: number) =>
  '#' +
  channels(h)
    .map((v) =>
      Math.round(v * (1 - amount))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

/**
 * Parses and checks the colours. White text sits on the main colour, the footer and buttons, and
 * links are this colour on white, so each must reach the WCAG AA ratio of 4.5:1 with white.
 */
export function parseTheme(input: unknown): ThemeColors {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Invalid colours.',
    );
  const t = parsed.data;
  const footer = t.footer || darker(t.primary, 0.45);
  const checks: [string, string][] = [
    [t.primary, 'The main colour is too light for the white text on it'],
    [t.action, 'The buttons & links colour is too light to read on white'],
    [footer, 'The footer colour is too light for the white text on it'],
  ];
  for (const [colour, message] of checks) {
    const ratio = contrastWithWhite(colour);
    if (ratio < MIN_CONTRAST)
      throw new BadRequestException(
        `${message} (${ratio.toFixed(1)}:1, needs ${MIN_CONTRAST}:1). Choose a darker shade or use "Make readable".`,
      );
  }
  return t;
}

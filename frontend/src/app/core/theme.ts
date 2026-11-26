/**
 * Site colours chosen in Admin → Site colours. Four colours are picked; every other shade the design
 * uses (hover, footer, light backgrounds, text on orange…) is worked out from them here, so the whole
 * site stays consistent and readable.
 */
export interface ThemeColors {
  /** Header, coloured sections and page banners. */
  primary: string;
  /** Links and main buttons. */
  action: string;
  /** Highlights: "Apply now", labels, focus rings. */
  accent: string;
  /** Footer and top bar. Empty = a darker shade of the main colour. */
  footer: string;
}

/** The original colours (RCMRD blue and orange) the stylesheet is written with. */
export const DEFAULT_THEME: ThemeColors = {
  primary: '#0033a0',
  action: '#0345bf',
  accent: '#ef6d00',
  footer: '#001a5c',
};

export interface ThemePreset {
  name: string;
  colors: ThemeColors;
}

/** Ready-made colour sets; every one passes the readability checks. */
export const THEME_PRESETS: ThemePreset[] = [
  { name: 'Original blue & orange', colors: DEFAULT_THEME },
  { name: 'Forest green & gold', colors: { primary: '#14532d', action: '#15803d', accent: '#eab308', footer: '#0b2e19' } },
  { name: 'Maroon & gold', colors: { primary: '#7a1f2b', action: '#9b2335', accent: '#e0a526', footer: '#43111a' } },
  { name: 'Teal & coral', colors: { primary: '#0f5257', action: '#0e7480', accent: '#f26b4f', footer: '#08303a' } },
  { name: 'Royal purple & amber', colors: { primary: '#4c1d95', action: '#6d28d9', accent: '#f59e0b', footer: '#2e1065' } },
  { name: 'Navy & sky', colors: { primary: '#0b2545', action: '#1d4ed8', accent: '#38bdf8', footer: '#061528' } },
  { name: 'Charcoal & red', colors: { primary: '#1f2937', action: '#b91c1c', accent: '#ef4444', footer: '#111827' } },
];

export interface NamedColour {
  name: string;
  hex: string;
}

const c = (name: string, hex: string): NamedColour => ({ name, hex });

/** Deep colours that white text reads well on: for the main colour and the footer. */
const DEEP: NamedColour[] = [
  c('Royal blue', '#0033a0'), c('Navy', '#0b2545'), c('Cobalt', '#1e40af'), c('Ocean', '#075985'),
  c('Teal', '#0f5257'), c('Forest green', '#14532d'), c('Emerald', '#065f46'), c('Olive', '#3f6212'),
  c('Maroon', '#7a1f2b'), c('Crimson', '#9f1239'), c('Burgundy', '#5b1a2e'), c('Royal purple', '#4c1d95'),
  c('Plum', '#6b21a8'), c('Chocolate', '#5c3d1e'), c('Slate', '#334155'), c('Charcoal', '#1f2937'),
];

/**
 * Colours offered as swatches for each choice, so nobody needs colour codes. The deep ones
 * (main, buttons, footer) all pass the readability checks; highlights are bright on purpose.
 */
export const COLOUR_SWATCHES: Record<keyof ThemeColors, NamedColour[]> = {
  primary: DEEP,
  footer: [
    c('Midnight blue', '#001a5c'), c('Deep navy', '#061528'), ...DEEP.filter((x) => x.name !== 'Navy'),
    c('Deep green', '#0b2e19'), c('Deep maroon', '#43111a'), c('Black', '#111111'),
  ],
  action: [
    c('Blue', '#0345bf'), c('Bright blue', '#1d4ed8'), c('Ocean', '#0369a1'), c('Teal', '#0e7480'),
    c('Green', '#15803d'), c('Emerald', '#047857'), c('Olive', '#4d7c0f'), c('Burnt orange', '#c2410c'),
    c('Brown', '#92400e'), c('Red', '#b91c1c'), c('Crimson', '#be123c'), c('Maroon', '#9b2335'),
    c('Magenta', '#a21caf'), c('Purple', '#6d28d9'), c('Indigo', '#4338ca'), c('Slate', '#475569'),
  ],
  accent: [
    c('Orange', '#ef6d00'), c('Tangerine', '#f97316'), c('Amber', '#f59e0b'), c('Gold', '#eab308'),
    c('Sunflower', '#facc15'), c('Lime', '#84cc16'), c('Green', '#22c55e'), c('Mint', '#10b981'),
    c('Turquoise', '#14b8a6'), c('Sky blue', '#38bdf8'), c('Blue', '#3b82f6'), c('Lavender', '#a855f7'),
    c('Pink', '#ec4899'), c('Coral', '#f26b4f'), c('Red', '#ef4444'), c('Mustard', '#e0a526'),
  ],
};

/** A friendly name for a colour: the swatch name when it is one, otherwise "Custom colour". */
export function colourName(hex: string): string {
  const h = hex.toLowerCase();
  for (const list of Object.values(COLOUR_SWATCHES)) {
    const hit = list.find((x) => x.hex === h);
    if (hit) return hit.name;
  }
  return 'Custom colour';
}

/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5;

const INK = '#1d2027';
const WHITE = '#ffffff';
const BLACK = '#000000';

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** `amount` of `b` mixed into `a` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * amount));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour darkened just enough to reach `ratio` against `against` (white by default). */
export function darkenUntil(hex: string, ratio = MIN_CONTRAST, against = WHITE): string {
  for (let step = 0; step <= 100; step++) {
    const c = mix(hex, BLACK, step / 100);
    if (contrast(c, against) >= ratio) return c;
  }
  return BLACK;
}

export function normalise(input: Partial<ThemeColors> | null | undefined): ThemeColors {
  const pick = (k: keyof ThemeColors) => (isHex(input?.[k]) ? input![k]!.toLowerCase() : k === 'footer' ? '' : DEFAULT_THEME[k]);
  return { primary: pick('primary'), action: pick('action'), accent: pick('accent'), footer: pick('footer') };
}

export const sameTheme = (a: ThemeColors, b: ThemeColors) =>
  a.primary === b.primary && a.action === b.action && a.accent === b.accent && (a.footer || '') === (b.footer || '');

export const footerOf = (t: ThemeColors) => t.footer || mix(t.primary, BLACK, 0.45);

export interface ThemeCheck {
  key: keyof ThemeColors;
  label: string;
  ratio: number;
  ok: boolean;
}

/** The readability checks the admin screen shows, and the server enforces. */
export function checkTheme(t: ThemeColors): ThemeCheck[] {
  const row = (key: keyof ThemeColors, label: string, ratio: number): ThemeCheck => ({ key, label, ratio, ok: ratio >= MIN_CONTRAST });
  return [
    row('primary', 'White text on the main colour (header, banners)', contrast(WHITE, t.primary)),
    row('action', 'Links on white, and white text on buttons', contrast(WHITE, t.action)),
    row('footer', 'White text on the footer', contrast(WHITE, footerOf(t))),
  ];
}

/** Every colour variable of the public stylesheet (styles.scss :root), worked out from the four choices. */
export function themeTokens(input: ThemeColors): Record<string, string> {
  const t = normalise(input);
  const accentOn = contrast(INK, t.accent) >= contrast(WHITE, t.accent) ? '#1d1206' : WHITE;
  return {
    '--primary': t.primary,
    '--primary-strong': mix(t.primary, BLACK, 0.25),
    '--primary-deep': footerOf(t),
    '--action': t.action,
    '--action-strong': mix(t.action, BLACK, 0.12),
    '--accent': t.accent,
    '--accent-strong': mix(t.accent, BLACK, 0.08),
    '--on-primary': WHITE,
    '--on-accent': accentOn,
    '--accent-text': darkenUntil(t.accent),
    '--surface-2': mix(t.primary, WHITE, 0.95),
    '--surface-3': mix(t.primary, WHITE, 0.9),
    '--focus': t.accent,
  };
}

/** The tokens as a CSS rule; empty for the original colours so the hand-tuned stylesheet values stay. */
export function themeCss(input: ThemeColors, selector = ':root'): string {
  const t = normalise(input);
  if (sameTheme(t, DEFAULT_THEME)) return '';
  const body = Object.entries(themeTokens(t))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `${selector}{${body}}`;
}

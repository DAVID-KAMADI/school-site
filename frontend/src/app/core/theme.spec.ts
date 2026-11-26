import { describe, expect, it } from 'vitest';
import { checkTheme, COLOUR_SWATCHES, colourName, contrast, darkenUntil, DEFAULT_THEME, normalise, THEME_PRESETS, themeCss, themeTokens } from './theme';

describe('site colours', () => {
  it('leaves the stylesheet alone for the original colours', () => {
    expect(themeCss(DEFAULT_THEME)).toBe('');
  });

  it('writes every colour variable for other colours', () => {
    const css = themeCss({ primary: '#14532d', action: '#15803d', accent: '#eab308', footer: '' });
    expect(css.startsWith(':root{--primary:#14532d;')).toBe(true);
    for (const v of ['--primary-deep', '--action-strong', '--accent-text', '--on-accent', '--surface-2'])
      expect(css).toContain(v + ':');
  });

  it('keeps text on the highlight colour and highlight-coloured text readable', () => {
    for (const accent of ['#ffff00', '#ef6d00', '#38bdf8', '#7a1f2b']) {
      const t = themeTokens({ ...DEFAULT_THEME, accent });
      expect(contrast(t['--on-accent'], accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['--accent-text'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every ready-made colour set passes the readability checks', () => {
    for (const p of THEME_PRESETS) expect(checkTheme(p.colors).every((c) => c.ok), p.name).toBe(true);
  });

  it('every swatch for the main colour, buttons and footer is readable with white text', () => {
    for (const key of ['primary', 'action', 'footer'] as const)
      for (const s of COLOUR_SWATCHES[key]) expect(contrast(s.hex, '#ffffff'), `${key} ${s.name}`).toBeGreaterThanOrEqual(4.5);
  });

  it('swatches are valid, unique colours and the presets have names', () => {
    for (const list of Object.values(COLOUR_SWATCHES)) {
      expect(new Set(list.map((s) => s.hex)).size).toBe(list.length);
      for (const s of list) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const p of THEME_PRESETS) for (const k of ['primary', 'action', 'accent'] as const) expect(colourName(p.colors[k]), `${p.name} ${k}`).not.toBe('Custom colour');
  });

  it('"Make readable" darkens just enough', () => {
    const fixed = darkenUntil('#7fb2ff');
    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fixed, '#ffffff')).toBeLessThan(5.2);
  });

  it('ignores anything that is not a colour', () => {
    expect(normalise({ primary: 'red;}body{display:none', action: '#ABCDEF' } as never)).toEqual({ ...DEFAULT_THEME, action: '#abcdef', footer: '' });
  });
});

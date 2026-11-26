import { describe, expect, it } from 'vitest';
import { contrastWithWhite, DEFAULT_THEME, parseTheme } from './theme.js';

describe('parseTheme', () => {
  it('accepts the original colours', () => {
    expect(parseTheme(DEFAULT_THEME)).toEqual(DEFAULT_THEME);
  });
  it('lower-cases and allows an automatic footer', () => {
    expect(
      parseTheme({ primary: '#14532D', action: '#15803D', accent: '#EAB308', footer: '' }),
    ).toEqual({ primary: '#14532d', action: '#15803d', accent: '#eab308', footer: '' });
  });
  it('refuses colours white text cannot be read on', () => {
    expect(() => parseTheme({ ...DEFAULT_THEME, primary: '#ffcc00' })).toThrow(/main colour/);
    expect(() => parseTheme({ ...DEFAULT_THEME, action: '#7fb2ff' })).toThrow(/links/);
    expect(() => parseTheme({ ...DEFAULT_THEME, footer: '#cccccc' })).toThrow(/footer/);
  });
  it('lets the accent be any colour (text on it is chosen automatically)', () => {
    expect(parseTheme({ ...DEFAULT_THEME, accent: '#ffff00' }).accent).toBe('#ffff00');
  });
  it('refuses anything that is not a colour, and extra fields', () => {
    expect(() => parseTheme({ ...DEFAULT_THEME, primary: 'red;}body{display:none' })).toThrow();
    expect(() => parseTheme({ ...DEFAULT_THEME, extra: '#000000' })).toThrow();
  });
  it('computes WCAG contrast', () => {
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastWithWhite('#ffffff')).toBeCloseTo(1, 5);
  });
});

import { describe, expect, it } from 'vitest';
import { ipExcluded, parseSettings } from './analytics-settings.service.js';
import { channelFor, isBot, normalisePath, parseUserAgent, referrerHost, screenCategory } from './classify.js';
import { toCsv } from './csv.js';
import { parseRange, previousRange } from './reports.service.js';

const noUtm = { source: null, medium: null, campaign: null, term: null, content: null };
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EDGE = `${CHROME_WIN} Edg/131.0.0.0`;

describe('user agents', () => {
  it('reads browser, OS and device type', () => {
    expect(parseUserAgent(CHROME_WIN)).toEqual({ device: 'desktop', browser: 'Chrome', os: 'Windows' });
    expect(parseUserAgent(ANDROID)).toEqual({ device: 'mobile', browser: 'Chrome', os: 'Android' });
    expect(parseUserAgent(IPAD)).toEqual({ device: 'tablet', browser: 'Safari', os: 'iOS' });
    expect(parseUserAgent(EDGE).browser).toBe('Edge');
  });

  it('spots bots and scripts', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot(`${CHROME_WIN} HeadlessChrome`)).toBe(true);
    expect(isBot('')).toBe(true);
    expect(isBot(CHROME_WIN)).toBe(false);
    expect(isBot(ANDROID)).toBe(false);
  });

  it('groups screen widths', () => {
    expect(screenCategory(390)).toBe('small');
    expect(screenCategory(800)).toBe('medium');
    expect(screenCategory(1366)).toBe('large');
    expect(screenCategory(1920)).toBe('xlarge');
    expect(screenCategory('x')).toBeNull();
  });
});

describe('channels', () => {
  it('uses the referrer', () => {
    expect(channelFor(referrerHost('https://www.google.co.ke/search?q=x'), noUtm)).toBe('organic');
    expect(channelFor(referrerHost('https://l.facebook.com/'), noUtm)).toBe('social');
    expect(channelFor(referrerHost('https://t.co/abc'), noUtm)).toBe('social');
    expect(channelFor(referrerHost('https://kuccps.ac.ke/list'), noUtm)).toBe('referral');
    expect(channelFor(null, noUtm)).toBe('direct');
  });

  it('lets UTM tags win', () => {
    expect(channelFor('google.com', { ...noUtm, medium: 'cpc' })).toBe('paid');
    expect(channelFor(null, { ...noUtm, medium: 'email' })).toBe('email');
    expect(channelFor(null, { ...noUtm, source: 'newsletter' })).toBe('email');
    expect(channelFor(null, { ...noUtm, medium: 'social' })).toBe('social');
    expect(channelFor(null, { ...noUtm, source: 'facebook' })).toBe('social');
    expect(channelFor(null, { ...noUtm, source: 'poster' })).toBe('referral');
  });

  it('ignores non-web referrers', () => {
    expect(referrerHost('android-app://com.google.android.gm')).toBeNull();
    expect(referrerHost('not a url')).toBeNull();
  });
});

describe('paths', () => {
  it('drops query strings, fragments and trailing slashes', () => {
    expect(normalisePath('/apply/?email=a@b.c#top')).toBe('/apply');
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('https://evil.example/')).toBeNull();
  });

  it('hides personal links', () => {
    expect(normalisePath('/preview/abc123')).toBe('/preview/…');
    expect(normalisePath('/admin/AbCdEfGhIjKlMnOpQrStUvWx')).toBe('/admin/…');
  });
});

describe('settings', () => {
  const base = { retentionMonths: 13 };

  it('accepts valid settings and fills defaults', () => {
    const s = parseSettings({ ...base, excludedIps: ['10.0.0.0/8', '41.90.1.2'] });
    expect(s.enabled).toBe(true);
    expect(s.excludedIps).toEqual(['10.0.0.0/8', '41.90.1.2']);
  });

  it('rejects bad values', () => {
    expect(() => parseSettings({ retentionMonths: 0 })).toThrow();
    expect(() => parseSettings({ ...base, excludedIps: ['office'] })).toThrow();
    expect(() => parseSettings({ ...base, customEvents: [{ name: 'Bad Name', type: 'click', value: '.x' }] })).toThrow();
    expect(() => parseSettings({ ...base, funnels: [{ name: 'One step', steps: [{ type: 'page', value: '/apply' }] }] })).toThrow();
  });

  it('matches excluded addresses and ranges', () => {
    expect(ipExcluded('192.168.1.40', ['192.168.1.0/24'])).toBe(true);
    expect(ipExcluded('::ffff:192.168.1.40', ['192.168.1.0/24'])).toBe(true);
    expect(ipExcluded('192.168.2.40', ['192.168.1.0/24'])).toBe(false);
    expect(ipExcluded('41.90.1.2', ['41.90.1.2'])).toBe(true);
    expect(ipExcluded(null, ['41.90.1.2'])).toBe(false);
  });
});

describe('date ranges', () => {
  it('uses whole local days and an equal previous period', () => {
    const r = parseRange({ from: '2026-11-01', to: '2026-11-07' });
    expect(r.days).toBe(7);
    const p = previousRange(r);
    expect(p.from).toBe('2026-10-25');
    expect(p.to).toBe('2026-10-31');
    expect(p.end.getTime()).toBe(r.start.getTime());
  });

  it('rejects reversed or huge ranges', () => {
    expect(() => parseRange({ from: '2026-11-07', to: '2026-11-01' })).toThrow();
    expect(() => parseRange({ from: '2020-01-01', to: '2026-11-01' })).toThrow();
  });
});

describe('CSV', () => {
  it('quotes cells and blocks formulas', () => {
    const csv = toCsv([{ path: '/a,b', title: '=HYPERLINK("x")', views: 3 }]);
    expect(csv).toContain('"/a,b"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.startsWith('﻿path,title,views')).toBe(true);
  });
});

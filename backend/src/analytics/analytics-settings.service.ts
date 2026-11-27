import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';

export const SETTINGS_KEY = 'analytics.settings';

/** A custom event the tracker records on the website without code changes. */
export interface CustomEventRule {
  /** Event name, e.g. "brochure_click". */
  name: string;
  /** "click": clicks on elements matching a CSS selector. "link": clicks on links whose address contains the text. "page": visits to pages starting with the path. */
  type: 'click' | 'link' | 'page';
  value: string;
}

export interface FunnelStep {
  /** "page": a page whose path starts with value. "event": an event with that name. */
  type: 'page' | 'event';
  value: string;
  label: string;
}

export interface Funnel {
  name: string;
  steps: FunnelStep[];
}

export interface AnalyticsSettings {
  enabled: boolean;
  /** Don't count browsers that send Do Not Track or Global Privacy Control. */
  respectDoNotTrack: boolean;
  /** Raw visits older than this are deleted every night. */
  retentionMonths: number;
  /** Don't count people signed in to the admin portal. */
  excludeStaff: boolean;
  /** Office or test addresses not to count: single addresses or IPv4 ranges like 192.168.1.0/24. */
  excludedIps: string[];
  customEvents: CustomEventRule[];
  funnels: Funnel[];
}

export const DEFAULT_SETTINGS: AnalyticsSettings = {
  enabled: true,
  respectDoNotTrack: true,
  retentionMonths: 13,
  excludeStaff: true,
  excludedIps: [],
  customEvents: [],
  funnels: [],
};

export const EVENT_NAME = /^[a-z][a-z0-9_]{1,59}$/;
const IP_RULE = /^(\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-f:]{2,39})$/i;

const bad = (message: string) => new BadRequestException({ message, code: 'VALIDATION' });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Checks and cleans settings sent from the admin screen. */
export function parseSettings(body: unknown): AnalyticsSettings {
  if (!body || typeof body !== 'object') throw bad('Send the analytics settings.');
  const b = body as Record<string, unknown>;
  const months = Number(b.retentionMonths);
  if (!Number.isInteger(months) || months < 1 || months > 60)
    throw bad('Keep visits for between 1 and 60 months.');

  const ips = (Array.isArray(b.excludedIps) ? b.excludedIps : []).map((v) => str(v, 43)).filter(Boolean);
  const wrongIp = ips.find((ip) => !IP_RULE.test(ip));
  if (wrongIp) throw bad(`"${wrongIp}" is not an IP address or range.`);
  if (ips.length > 50) throw bad('Up to 50 excluded addresses.');

  const customEvents = (Array.isArray(b.customEvents) ? b.customEvents : []).map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = str(r.name, 60);
    const type = r.type === 'link' || r.type === 'page' ? r.type : 'click';
    const value = str(r.value, 200);
    if (!EVENT_NAME.test(name))
      throw bad(`Custom event ${i + 1}: the name must be lower case letters, digits and _ (e.g. brochure_click).`);
    if (!value) throw bad(`Custom event ${i + 1}: say what to track.`);
    if (type === 'page' && !value.startsWith('/')) throw bad(`Custom event ${i + 1}: a page path starts with /.`);
    return { name, type, value } as CustomEventRule;
  });
  if (customEvents.length > 50) throw bad('Up to 50 custom events.');

  const funnels = (Array.isArray(b.funnels) ? b.funnels : []).map((raw, i) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    const name = str(f.name, 80);
    if (!name) throw bad(`Funnel ${i + 1} needs a name.`);
    const steps = (Array.isArray(f.steps) ? f.steps : []).map((s, j) => {
      const step = (s ?? {}) as Record<string, unknown>;
      const type = step.type === 'event' ? 'event' : 'page';
      const value = str(step.value, 200);
      if (!value) throw bad(`${name}, step ${j + 1}: choose a page or event.`);
      if (type === 'page' && !value.startsWith('/')) throw bad(`${name}, step ${j + 1}: a page path starts with /.`);
      return { type, value, label: str(step.label, 80) || value } as FunnelStep;
    });
    if (steps.length < 2 || steps.length > 8) throw bad(`${name}: a funnel has 2 to 8 steps.`);
    return { name, steps };
  });
  if (funnels.length > 10) throw bad('Up to 10 funnels.');

  return {
    enabled: b.enabled !== false,
    respectDoNotTrack: b.respectDoNotTrack !== false,
    retentionMonths: months,
    excludeStaff: b.excludeStaff !== false,
    excludedIps: ips,
    customEvents,
    funnels,
  };
}

/** True when the address is in the list (exact match, or inside an IPv4 /n range). */
export function ipExcluded(ip: string | null | undefined, rules: readonly string[]): boolean {
  if (!ip || !rules.length) return false;
  const address = ip.replace(/^::ffff:/, '');
  const toInt = (v: string) => v.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
  return rules.some((rule) => {
    if (!rule.includes('/')) return rule.toLowerCase() === address.toLowerCase();
    const [base, bits] = rule.split('/');
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (toInt(address) & mask) === (toInt(base) & mask);
  });
}

/** Analytics settings, kept in site_settings (group "analytics", never sent to the public site as a whole). */
@Injectable()
export class AnalyticsSettingsService {
  private cache: { value: AnalyticsSettings; at: number } | null = null;

  constructor(@InjectRepository(SiteSetting) private readonly settings: Repository<SiteSetting>) {}

  /** Cached for 30 s: read on every page view, and other API processes may have changed it. */
  async get(): Promise<AnalyticsSettings> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.value;
    const row = await this.settings.findOne({ where: { key: SETTINGS_KEY } });
    const value = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AnalyticsSettings>) ?? {}) };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async save(body: unknown, userId: number): Promise<AnalyticsSettings> {
    const value = parseSettings(body);
    await this.settings.save({
      key: SETTINGS_KEY,
      value,
      groupName: 'analytics',
      description: 'Web analytics settings (Admin → Web analytics → Settings).',
      updatedBy: { id: userId },
    });
    this.cache = { value, at: Date.now() };
    return value;
  }
}

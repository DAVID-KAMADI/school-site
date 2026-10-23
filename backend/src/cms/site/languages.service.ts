import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ContentCacheService } from '../content-cache.service.js';
import { Page } from '../entities/page.entity.js';
import { SiteSetting } from '../entities/site-setting.entity.js';
import { RESERVED_TOP_LEVEL_SLUGS } from '../pages/page-paths.js';

export interface Language {
  /** Two-letter code, e.g. "fr". Also the first part of the address: /fr/admissions. */
  code: string;
  /** Name in the language itself, e.g. "Français", as visitors see it in the switcher. */
  name: string;
  dir: 'ltr' | 'rtl';
}

export const MAIN_LANGUAGE = 'en';

/** Languages written right to left. */
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'dv', 'yi']);

/**
 * Settings that hold words visitors read, and so can be translated.
 * Banners are translated through their `text` field.
 */
export const TRANSLATABLE_SETTINGS = [
  'institution.name',
  'institution.short_name',
  'institution.tagline',
  'contact.address',
  'contact.office_hours',
  'payments.mpesa_account_hint',
  'banner.alert',
  'banner.intake',
  'seo.default_description',
  'admissions.welcome',
  'admissions.declaration',
];

const LIST_KEY = 'languages.enabled';
const SETTINGS_KEY = 'languages.setting_translations';

type SettingTranslations = Record<string, Record<string, string>>;

/** The languages visitors can choose, and the parts of the site that change with them. */
@Injectable()
export class LanguagesService {
  constructor(
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    @InjectRepository(Page) private readonly pages: Repository<Page>,
    private readonly cache: ContentCacheService,
  ) {}

  /** Enabled languages, English first. */
  list(): Promise<Language[]> {
    return this.cache.getOrLoad('languages', async () => {
      const row = await this.settings.findOneBy({ key: LIST_KEY });
      const stored = Array.isArray(row?.value)
        ? (row.value as { code: string; name: string }[])
        : [];
      const english = stored.find((l) => l.code === MAIN_LANGUAGE) ?? {
        code: MAIN_LANGUAGE,
        name: 'English',
      };
      return [english, ...stored.filter((l) => l.code !== MAIN_LANGUAGE)].map(
        (l) => ({
          code: l.code,
          name: l.name,
          dir: RTL.has(l.code) ? ('rtl' as const) : ('ltr' as const),
        }),
      );
    });
  }

  /** True for an enabled language other than English (one that pages are translated into). */
  async isTranslation(code: string): Promise<boolean> {
    return (
      code !== MAIN_LANGUAGE && (await this.list()).some((l) => l.code === code)
    );
  }

  /** Throws unless `code` is an enabled translation language. */
  async requireTranslation(code: string): Promise<Language> {
    const lang = (await this.list()).find(
      (l) => l.code === code && l.code !== MAIN_LANGUAGE,
    );
    if (!lang)
      throw new BadRequestException(
        'Add this language under Languages before translating into it.',
      );
    return lang;
  }

  /** "/fr/about/history" -> { locale: "fr", path: "/about/history" } when French is enabled. */
  async splitPath(path: string): Promise<{ locale: string; path: string }> {
    const match = /^\/([a-z]{2})(\/.*)?$/.exec(path);
    if (match && (await this.isTranslation(match[1])))
      return { locale: match[1], path: match[2] || '/' };
    return { locale: MAIN_LANGUAGE, path };
  }

  /** Adds the language prefix to a site path: ("fr", "/about") -> "/fr/about", ("fr", "/") -> "/fr". */
  static localize(locale: string, path: string): string {
    if (locale === MAIN_LANGUAGE) return path;
    return path === '/' ? `/${locale}` : `/${locale}${path}`;
  }

  /** Replaces the whole list. English cannot be removed; its display name can change. */
  async save(input: unknown, userId: number): Promise<Language[]> {
    if (!Array.isArray(input) || input.length > 20)
      throw new BadRequestException('Send a list of up to 20 languages.');
    const seen = new Set<string>();
    const list: { code: string; name: string }[] = [];
    for (const raw of input as unknown[]) {
      const item = raw as { code?: unknown; name?: unknown };
      const code = typeof item?.code === 'string' ? item.code.trim() : '';
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!/^[a-z]{2}$/.test(code))
        throw new BadRequestException(
          `"${code}" is not a two-letter language code (for example fr or sw).`,
        );
      if (!name || name.length > 40)
        throw new BadRequestException(
          `Give ${code} a name of up to 40 characters.`,
        );
      if (seen.has(code))
        throw new BadRequestException(`${code} is listed twice.`);
      seen.add(code);
      if (code !== MAIN_LANGUAGE) {
        if (RESERVED_TOP_LEVEL_SLUGS.has(code))
          throw new BadRequestException(
            `"${code}" is used by the system and cannot be a language code.`,
          );
        if (
          await this.pages.exists({
            where: { path: `/${code}` },
            withDeleted: true,
          })
        )
          throw new BadRequestException(
            `A page already uses the address /${code}. Change that page's address first.`,
          );
      }
      list.push({ code, name });
    }
    const english = list.find((l) => l.code === MAIN_LANGUAGE) ?? {
      code: MAIN_LANGUAGE,
      name: 'English',
    };
    const value = [english, ...list.filter((l) => l.code !== MAIN_LANGUAGE)];
    await this.settings.update(
      { key: LIST_KEY },
      { value, updatedBy: { id: userId } },
    );
    this.cache.invalidate();
    return this.list();
  }

  /** Translated settings for every language: { fr: { "institution.tagline": "…" } }. */
  async settingTranslations(): Promise<SettingTranslations> {
    const row = await this.settings.findOneBy({ key: SETTINGS_KEY });
    const value = row?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SettingTranslations)
      : {};
  }

  /** Saves one language's translated settings. Empty values fall back to English. */
  async saveSettingTranslations(
    locale: string,
    input: unknown,
    userId: number,
  ) {
    await this.requireTranslation(locale);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException('Send the translated values by setting.');
    const values: Record<string, string> = {};
    for (const [key, raw] of Object.entries(input)) {
      if (!TRANSLATABLE_SETTINGS.includes(key))
        throw new BadRequestException(`${key} cannot be translated.`);
      if (typeof raw !== 'string' || raw.length > 5000)
        throw new BadRequestException(`${key} must be text.`);
      if (raw.trim()) values[key] = raw.trim();
    }
    const all = await this.settingTranslations();
    all[locale] = values;
    await this.settings.update(
      { key: SETTINGS_KEY },
      { value: all, updatedBy: { id: userId } },
    );
    this.cache.invalidate();
    return values;
  }

  /** Overlays a language's translated settings onto the English values. */
  async applySettingTranslations(
    values: Record<string, unknown>,
    locale: string,
  ): Promise<Record<string, unknown>> {
    if (locale === MAIN_LANGUAGE) return values;
    const translated = (await this.settingTranslations())[locale] ?? {};
    const out = { ...values };
    for (const [key, text] of Object.entries(translated)) {
      if (!TRANSLATABLE_SETTINGS.includes(key) || !(key in out)) continue;
      const base = out[key];
      out[key] =
        base && typeof base === 'object' && !Array.isArray(base)
          ? { ...base, text }
          : text;
    }
    return out;
  }
}

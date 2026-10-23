import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  In,
  IsNull,
  Not,
  type Repository,
} from 'typeorm';
import { z } from 'zod';
import { safeHref } from '../blocks/block-schemas.js';
import { withDeadlockRetry } from '../../database/retry.js';
import { ContentCacheService } from '../content-cache.service.js';
import { MenuItem } from '../entities/menu-item.entity.js';
import { Menu } from '../entities/menu.entity.js';
import { Page, PageVisibility } from '../entities/page.entity.js';
import { Redirect } from '../entities/redirect.entity.js';
import { SiteSetting } from '../entities/site-setting.entity.js';
import { TextString } from '../entities/text-string.entity.js';
import { MediaService } from '../media/media.service.js';
import {
  LanguagesService,
  TRANSLATABLE_SETTINGS,
} from './languages.service.js';

export interface MenuItemInput {
  label: string;
  translations?: Record<string, string>;
  pageId?: number | null;
  url?: string | null;
  openInNewTab?: boolean;
  isButton?: boolean;
  isVisible?: boolean;
  children?: MenuItemInput[];
}

const menuItemSchema: z.ZodType<MenuItemInput> = z.lazy(() =>
  z
    .object({
      label: z.string().trim().min(1).max(100),
      translations: z
        .record(z.string().regex(/^[a-z]{2}$/), z.string().trim().max(100))
        .optional(),
      pageId: z.number().int().positive().nullable().optional(),
      url: safeHref.nullable().optional(),
      openInNewTab: z.boolean().optional(),
      isButton: z.boolean().optional(),
      isVisible: z.boolean().optional(),
      children: z.array(menuItemSchema).max(30).optional(),
    })
    .refine((i) => !!i.pageId !== !!i.url, {
      message: 'Each menu item links to either a page or a URL.',
    }),
);

/** Menus, site settings, interface text and redirects, plus the public "site" payload. */
@Injectable()
export class SiteService {
  constructor(
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(MenuItem)
    private readonly menuItems: Repository<MenuItem>,
    @InjectRepository(SiteSetting)
    private readonly settings: Repository<SiteSetting>,
    @InjectRepository(TextString)
    private readonly texts: Repository<TextString>,
    @InjectRepository(Redirect)
    private readonly redirects: Repository<Redirect>,
    @InjectRepository(Page) private readonly pages: Repository<Page>,
    private readonly media: MediaService,
    private readonly cache: ContentCacheService,
    private readonly dataSource: DataSource,
    private readonly languages: LanguagesService,
  ) {}

  // ---------- Menus ----------

  async adminMenus() {
    const menus = await this.menus.find({ order: { id: 'ASC' } });
    const items = await this.menuItems.find({
      relations: { menu: true, parent: true, page: true },
      order: { sortOrder: 'ASC' },
    });
    return menus.map((m) => ({
      location: m.location,
      name: m.name,
      items: this.nest(
        items.filter((i) => i.menu.id === m.id),
        (i) => ({
          id: i.id,
          label: i.label,
          translations: i.translations ?? {},
          pageId: i.page?.id ?? null,
          pagePath: i.page?.path ?? null,
          url: i.url,
          openInNewTab: i.openInNewTab,
          isButton: i.isButton,
          isVisible: i.isVisible,
        }),
      ),
    }));
  }

  /** Replaces a menu's whole tree (the admin editor sends the full, reordered list). */
  async saveMenu(location: string, input: unknown) {
    const menu = await this.menus.findOneBy({ location });
    if (!menu) throw new NotFoundException('Menu not found.');
    const parsed = z.array(menuItemSchema).max(60).safeParse(input);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Invalid menu items.',
        issues: parsed.error.issues,
      });
    const depth = (items: MenuItemInput[], level: number): number =>
      Math.max(level, ...items.map((i) => depth(i.children ?? [], level + 1)));
    if (depth(parsed.data, 1) > 3)
      throw new BadRequestException('Menus can be at most three levels deep.');

    const pageIds = new Set<number>();
    const walk = (items: MenuItemInput[]) =>
      items.forEach(
        (i) => (i.pageId && pageIds.add(i.pageId), walk(i.children ?? [])),
      );
    walk(parsed.data);
    const found = pageIds.size
      ? await this.pages.findBy({ id: In([...pageIds]) })
      : [];
    if (found.length !== pageIds.size)
      throw new BadRequestException(
        'A menu item links to a page that does not exist.',
      );

    await this.tx(async (em) => {
      await em.delete(MenuItem, { menu: { id: menu.id } });
      const insert = async (
        items: MenuItemInput[],
        parentId: number | null,
      ) => {
        for (const [i, item] of items.entries()) {
          const { identifiers } = await em.insert(MenuItem, {
            menu: { id: menu.id },
            parent: parentId ? { id: parentId } : null,
            label: item.label,
            translations: cleanTranslations(item.translations),
            page: item.pageId ? { id: item.pageId } : null,
            url: item.url ?? null,
            openInNewTab: item.openInNewTab ?? false,
            isButton: item.isButton ?? false,
            isVisible: item.isVisible ?? true,
            sortOrder: i,
          });
          await insert(item.children ?? [], identifiers[0].id as number);
        }
      };
      await insert(parsed.data, null);
    });
    this.cache.invalidate();
    return (await this.adminMenus()).find((m) => m.location === location);
  }

  // ---------- Settings ----------

  /** Settings edited on the Site settings page. Language settings have their own page. */
  async adminSettings() {
    return this.settings.find({
      where: { groupName: Not('languages') },
      order: { groupName: 'ASC', key: 'ASC' },
    });
  }

  /** The settings that hold words visitors read, with their English values. */
  async translatableSettings() {
    const rows = await this.settings.findBy({ key: In(TRANSLATABLE_SETTINGS) });
    return TRANSLATABLE_SETTINGS.flatMap((key) => {
      const row = rows.find((r) => r.key === key);
      if (!row) return [];
      const v = row.value;
      const text =
        v && typeof v === 'object' && 'text' in v
          ? (v as { text: unknown }).text
          : v;
      const english = typeof text === 'string' ? text : null;
      return english === null
        ? []
        : [{ key, description: row.description, english }];
    });
  }

  /** Updates one setting. The new value must have the same shape as the seeded one. */
  async saveSetting(key: string, value: unknown, userId: number) {
    const existing = await this.settings.findOneBy({ key });
    if (!existing || existing.groupName === 'languages')
      throw new NotFoundException('Unknown setting.');
    const expected = this.shapeOf(existing.value);
    if (
      expected !== 'null' &&
      value !== null &&
      this.shapeOf(value) !== expected
    ) {
      throw new BadRequestException(`This setting expects a ${expected}.`);
    }
    if (typeof value === 'string' && value.length > 5000)
      throw new BadRequestException('Value is too long.');
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing.value &&
      typeof existing.value === 'object'
    ) {
      const allowed = new Set(Object.keys(existing.value));
      const extra = Object.keys(value).filter((k) => !allowed.has(k));
      if (extra.length)
        throw new BadRequestException(`Unknown fields: ${extra.join(', ')}`);
      for (const [k, v] of Object.entries(value)) {
        if (
          (k === 'link' ||
            [
              'facebook',
              'x',
              'instagram',
              'linkedin',
              'youtube',
              'tiktok',
            ].includes(k)) &&
          v &&
          !safeHref.safeParse(v).success
        ) {
          throw new BadRequestException(
            `${k} must be a site path or full https:// link.`,
          );
        }
      }
    }
    if (
      key.endsWith('media_id') &&
      value !== null &&
      (typeof value !== 'number' || (await this.media.missing([value])).length)
    ) {
      throw new BadRequestException(
        'Choose an existing image from the media library.',
      );
    }
    await this.settings.update(
      { key },
      { value: value as object, updatedBy: { id: userId } },
    );
    this.cache.invalidate();
    return this.settings.findOneBy({ key });
  }

  private shapeOf(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'list';
    return typeof v === 'object'
      ? 'group of fields'
      : typeof v === 'number'
        ? 'number'
        : typeof v === 'boolean'
          ? 'yes/no value'
          : 'text';
  }

  // ---------- Interface text ----------

  adminTexts(locale?: string) {
    return this.texts.find({
      where: locale ? { locale } : {},
      order: { key: 'ASC', locale: 'ASC' },
    });
  }

  /** Edits a string, or adds a translation for an existing key in another locale. */
  async saveText(key: string, locale: string, value: string, userId: number) {
    if (!(await this.texts.exists({ where: { key } })))
      throw new NotFoundException('Unknown text key.');
    const existing = await this.texts.findOneBy({ key, locale });
    if (existing)
      await this.texts.update(existing.id, {
        value,
        updatedBy: { id: userId },
      });
    else {
      const base = await this.texts.findOneBy({ key, locale: 'en' });
      await this.texts.insert({
        key,
        locale,
        value,
        description: base?.description ?? null,
        updatedBy: { id: userId },
      });
    }
    this.cache.invalidate();
    return this.texts.findOneBy({ key, locale });
  }

  // ---------- Redirects ----------

  listRedirects() {
    return this.redirects.find({ order: { fromPath: 'ASC' } });
  }

  async saveRedirect(fromPath: string, toPath: string, statusCode: 301 | 302) {
    if (await this.pages.exists({ where: { path: fromPath } })) {
      throw new BadRequestException(
        'A live page already uses this address; redirects only apply to addresses without a page.',
      );
    }
    await this.redirects.upsert({ fromPath, toPath, statusCode }, ['fromPath']);
    this.cache.invalidate();
    return this.redirects.findOneBy({ fromPath });
  }

  async deleteRedirect(id: number) {
    await this.redirects.delete(id);
    this.cache.invalidate();
  }

  async findRedirect(path: string) {
    const r = await this.redirects.findOneBy({ fromPath: path });
    if (r) await this.redirects.increment({ id: r.id }, 'hitCount', 1);
    return r;
  }

  // ---------- Public site payload ----------

  /** Everything the header and footer need, in one cached call, in the visitor's language. */
  async publicSite(requested: string) {
    const locale = (await this.languages.isTranslation(requested))
      ? requested
      : 'en';
    return this.cache.getOrLoad(`site:${locale}`, async () => {
      const settings = await this.settings.find({
        where: { groupName: Not('languages') },
      });
      const values = await this.languages.applySettingTranslations(
        Object.fromEntries(settings.map((s) => [s.key, s.value])),
        locale,
      );
      const mediaIds = settings
        .filter(
          (s) => s.key.endsWith('media_id') && typeof s.value === 'number',
        )
        .map((s) => s.value as number);
      const media = await this.media.getMany(mediaIds);

      const texts = await this.texts.find({
        where: [{ locale: 'en' }, { locale }],
      });
      const text: Record<string, string> = {};
      for (const t of texts.filter((t) => t.locale === 'en'))
        text[t.key] = t.value;
      for (const t of texts.filter((t) => t.locale === locale))
        text[t.key] = t.value;

      return {
        locale,
        languages: await this.languages.list(),
        settings: values,
        media: Object.fromEntries(media),
        text,
        menus: await this.publicMenus(locale),
      };
    });
  }

  private async publicMenus(locale: string) {
    const livePages = await this.pages.find({
      where: {
        publishedRevision: Not(IsNull()),
        visibility: PageVisibility.Public,
      },
      select: { id: true, path: true },
    });
    const pathOf = new Map(livePages.map((p) => [p.id, p.path]));
    const items = await this.menuItems.find({
      where: { isVisible: true },
      relations: { menu: true, parent: true, page: true },
      order: { sortOrder: 'ASC' },
    });
    // Links to unpublished pages are hidden from visitors instead of showing broken links.
    const visible = items.filter((i) => !i.page || pathOf.has(i.page.id));
    const menus: Record<string, unknown[]> = {};
    for (const location of new Set(visible.map((i) => i.menu.location))) {
      menus[location] = this.nest(
        visible.filter((i) => i.menu.location === location),
        (i) => ({
          label: i.translations?.[locale] || i.label,
          href: i.page ? pathOf.get(i.page.id)! : i.url!,
          openInNewTab: i.openInNewTab,
          isButton: i.isButton,
        }),
      );
    }
    return menus;
  }

  private nest<T extends object>(
    items: MenuItem[],
    map: (i: MenuItem) => T,
  ): (T & { children: unknown[] })[] {
    const ids = new Set(items.map((i) => i.id));
    const build = (parentId: number | null): (T & { children: unknown[] })[] =>
      items
        .filter(
          (i) =>
            (i.parent?.id ?? null) === parentId ||
            (parentId === null && i.parent && !ids.has(i.parent.id)),
        )
        .map((i) => ({ ...map(i), children: build(i.id) }));
    return build(null);
  }

  /** Transaction that is retried if MySQL reports a deadlock. */
  private tx<T>(work: (em: EntityManager) => Promise<T>): Promise<T> {
    return withDeadlockRetry(() => this.dataSource.transaction(work));
  }
}

/** Drops empty translations so a blank field falls back to the main label. */
function cleanTranslations(input?: Record<string, string>) {
  const entries = Object.entries(input ?? {}).filter(([, v]) => v.trim());
  return entries.length ? Object.fromEntries(entries) : null;
}

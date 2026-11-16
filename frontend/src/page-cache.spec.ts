import { describe, expect, it } from 'vitest';
import { cacheKey, pageCacheSeconds, PageCache, withNonce, type RenderedPage } from './page-cache';

const page = (over: Partial<RenderedPage> = {}): RenderedPage => ({
  status: 200,
  headers: [['content-type', 'text/html']],
  body: '<script nonce="AAA">x</script><app ngCspNonce="AAA"></app>',
  nonce: 'AAA',
  cacheable: true,
  ...over,
});

const req = (path: string, extra: { method?: string; cookie?: string; lang?: string } = {}) => ({
  method: extra.method ?? 'GET',
  path: path.split('?')[0],
  originalUrl: path,
  headers: { cookie: extra.cookie, 'accept-language': extra.lang },
});

describe('pageCacheSeconds', () => {
  it('is 30 in production and off elsewhere by default', () => {
    expect(pageCacheSeconds(undefined, true)).toBe(30);
    expect(pageCacheSeconds(undefined, false)).toBe(0);
  });
  it('takes the setting, 0 turns it off, nonsense is off', () => {
    expect(pageCacheSeconds('60', false)).toBe(60);
    expect(pageCacheSeconds('0', true)).toBe(0);
    expect(pageCacheSeconds('abc', true)).toBe(0);
    expect(pageCacheSeconds('99999', true)).toBe(600);
  });
});

describe('cacheKey', () => {
  it('keys public pages on the address alone', () => {
    expect(cacheKey(req('/admissions'))).toBe('/admissions');
    expect(cacheKey(req('/fr/admissions', { cookie: 'site_lang=fr', lang: 'fr' }))).toBe('/fr/admissions');
    expect(cacheKey(req('/courses?page=2'))).toBe('/courses?page=2');
  });
  it('keys app pages on the language as well', () => {
    expect(cacheKey(req('/blog', { cookie: 'a=1; site_lang=sw', lang: 'sw-KE,en;q=0.8' }))).toBe('/blog|sw|sw,en');
    expect(cacheKey(req('/apply'))).toBe('/apply||');
  });
  it('never caches private pages or anything but GET', () => {
    for (const path of ['/admin', '/admin/pages', '/portal', '/login', '/preview/abc', '/apply/application'])
      expect(cacheKey(req(path))).toBeNull();
    expect(cacheKey(req('/admissions', { method: 'POST' }))).toBeNull();
    expect(cacheKey(req('/x?' + 'a'.repeat(400)))).toBeNull();
  });
});

describe('withNonce', () => {
  it('gives each visitor their own nonce', () => {
    expect(withNonce(page(), 'BBB')).toBe('<script nonce="BBB">x</script><app ngCspNonce="BBB"></app>');
    expect(withNonce(page({ nonce: null }), 'BBB')).toContain('AAA');
  });
});

describe('PageCache', () => {
  it('renders once and serves the copy until it expires', async () => {
    let now = 0;
    const cache = new PageCache(30_000, 10, () => now);
    let renders = 0;
    const render = async () => (renders++, page());
    expect((await cache.lookup('/', render)).source).toBe('miss');
    expect((await cache.lookup('/', render)).source).toBe('hit');
    now = 29_999;
    expect((await cache.lookup('/', render)).source).toBe('hit');
    now = 30_000;
    expect((await cache.lookup('/', render)).source).toBe('miss');
    expect(renders).toBe(2);
  });

  it('lets visitors who arrive during a render share it', async () => {
    const cache = new PageCache(30_000);
    let renders = 0;
    let finish!: (p: RenderedPage) => void;
    const slow = () => (renders++, new Promise<RenderedPage>((r) => (finish = r)));
    const first = cache.lookup('/', slow);
    const second = cache.lookup('/', slow);
    finish(page());
    expect((await first).source).toBe('miss');
    expect((await second).source).toBe('shared');
    expect(renders).toBe(1);
  });

  it('does not keep or share pages that must not be cached', async () => {
    const cache = new PageCache(30_000);
    let renders = 0;
    const render = async () => (renders++, page({ status: 404, cacheable: false }));
    const [a, b] = await Promise.all([cache.lookup('/x', render), cache.lookup('/x', render)]);
    expect([a.source, b.source]).toEqual(['miss', 'miss']);
    expect(renders).toBe(2);
    expect(cache.size).toBe(0);
  });

  it('lets a waiting visitor render again when the shared render fails', async () => {
    const cache = new PageCache(30_000);
    let fail!: (e: Error) => void;
    const first = cache.lookup('/', () => new Promise<RenderedPage>((_r, reject) => (fail = reject)));
    const second = cache.lookup('/', async () => page());
    fail(new Error('API down'));
    await expect(first).rejects.toThrow('API down');
    expect((await second).source).toBe('miss');
  });

  it('drops the least recently used page when full', async () => {
    const cache = new PageCache(30_000, 2);
    const render = async () => page();
    await cache.lookup('/a', render);
    await cache.lookup('/b', render);
    await cache.lookup('/a', render); // /a is now the most recent
    await cache.lookup('/c', render); // drops /b
    expect((await cache.lookup('/a', render)).source).toBe('hit');
    expect((await cache.lookup('/b', render)).source).toBe('miss');
  });
});

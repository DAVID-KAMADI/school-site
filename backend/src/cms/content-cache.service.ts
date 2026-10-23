import { Injectable } from '@nestjs/common';

/**
 * Small in-memory cache for public content (site settings, menus, text, rendered pages).
 * Any CMS write calls invalidate(), so visitors see changes immediately after publishing.
 * With several API servers in production, replace with a shared cache (e.g. Redis).
 */
@Injectable()
export class ContentCacheService {
  private readonly entries = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();
  private readonly ttlMs = 5 * 60_000;
  private readonly maxEntries = 500;

  async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const value = await load();
    if (this.entries.size >= this.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(): void {
    this.entries.clear();
  }
}

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Local disk storage for public media (images and public downloads), served at /media/*.
 * Swap for object storage (S3-compatible) in production by reimplementing this class.
 */
export class MediaStorage {
  readonly publicRoot: string;

  constructor(storageDir = process.env.STORAGE_DIR || 'storage') {
    this.publicRoot = resolve(storageDir, 'public');
  }

  private pathFor(key: string): string {
    const full = resolve(this.publicRoot, key);
    if (!full.startsWith(this.publicRoot + sep))
      throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Public URL path for a stored file. */
  url(key: string): string {
    return `/media/${key.split(sep).join('/')}`;
  }

  static key(...parts: string[]): string {
    return join(...parts)
      .split(sep)
      .join('/');
  }
}

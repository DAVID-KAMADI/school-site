import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import maxmind, { type CityResponse, type Reader } from 'maxmind';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export interface GeoResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

const NONE: GeoResult = { country: null, region: null, city: null };

/**
 * Approximate visitor location from the free DB-IP "IP to City Lite" database (CC BY 4.0,
 * https://db-ip.com). The file lives on this server, so addresses are looked up locally and never sent
 * anywhere; only country, region and city are kept, never the address. A fresh copy is downloaded each month.
 */
@Injectable()
export class GeoService implements OnModuleInit {
  private readonly log = new Logger('Analytics geo');
  // Outside storage/, so backups don't carry a 130 MB file that can simply be downloaded again.
  private readonly dir = resolve(process.env.GEO_DIR || 'geo-data');
  private readonly file = join(this.dir, 'dbip-city-lite.mmdb');
  private reader: Reader<CityResponse> | null = null;
  private downloading: Promise<void> | null = null;
  private lastError: string | null = null;

  async onModuleInit() {
    if (process.env.ANALYTICS_GEO === 'off') return;
    if (await this.open()) return;
    // First start: fetch the database in the background; locations show from then on.
    void this.update().catch(() => undefined);
  }

  lookup(ip: string | null | undefined): GeoResult {
    if (!ip || !this.reader) return NONE;
    try {
      const r = this.reader.get(ip.replace(/^::ffff:/, ''));
      if (!r) return NONE;
      return {
        country: r.country?.iso_code?.slice(0, 2) ?? null,
        region: r.subdivisions?.[0]?.names?.en?.slice(0, 80) ?? null,
        city: r.city?.names?.en?.slice(0, 80) ?? null,
      };
    } catch {
      return NONE;
    }
  }

  async status() {
    const info = await stat(this.file).catch(() => null);
    return {
      available: !!this.reader,
      updatedAt: info?.mtime ?? null,
      sizeMb: info ? Math.round(info.size / 1048576) : null,
      downloading: !!this.downloading,
      lastError: this.lastError,
    };
  }

  /** Monthly refresh (DB-IP publishes at the start of each month). */
  @Cron('0 30 4 3 * *')
  async refresh() {
    if (process.env.ANALYTICS_GEO !== 'off') await this.update().catch(() => undefined);
  }

  /** Downloads this month's file (or last month's, early in the month) and switches to it. */
  update(): Promise<void> {
    this.downloading ??= this.download().finally(() => (this.downloading = null));
    return this.downloading;
  }

  private async download() {
    await mkdir(this.dir, { recursive: true });
    // Own temporary file per process: several API processes may download at the same time.
    const tmp = `${this.file}.${process.pid}.download`;
    const now = new Date();
    const months = [0, 1].map((back) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
    for (const month of months) {
      const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
        if (!res.ok || !res.body) continue;
        await pipeline(Readable.fromWeb(res.body as never), createGunzip(), createWriteStream(tmp));
        await rename(tmp, this.file);
        if (!(await this.open())) throw new Error('downloaded file could not be read');
        this.lastError = null;
        this.log.log(`Location database updated (${month}).`);
        return;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        await rm(tmp, { force: true });
      }
    }
    this.lastError ??= 'The location database could not be downloaded.';
    this.log.warn(`Location database not updated: ${this.lastError}`);
    throw new Error(this.lastError);
  }

  private async open(): Promise<boolean> {
    try {
      await stat(this.file);
      this.reader = await maxmind.open<CityResponse>(this.file, { watchForUpdates: false });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Backups and rollback, shared by the admin page (BackupService) and the command line
 * (npm run backup / npm run restore). Each backup is a folder in BACKUP_DIR:
 *   database.sql.gz   full dump (consistent snapshot; the site keeps running)
 *   storage.tar.gz    public media and private applicant documents
 *   manifest.json     why and when it was made, row counts, file counts and checksums
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import {
  backupRoot,
  connectionArgs,
  dbSettings,
  folderStats,
  mysqlTool,
  run,
  sha256File,
  storageRoot,
  tarTool,
  type Manifest,
} from '../cli/backup-tools.js';

/** Why a backup was made. "before-restore" backups hold the state that a rollback replaced. */
export type BackupReason = 'manual' | 'scheduled' | 'before-restore' | 'command-line';

export interface BackupManifest extends Manifest {
  reason?: BackupReason;
  /** Who asked for it, e.g. "Jane Doe (jane@school.ac.ke)"; absent for scheduled and command-line backups. */
  createdBy?: string | null;
  /** A short note, e.g. "Before term results upload". */
  note?: string | null;
}

export interface BackupSummary {
  name: string;
  createdAt: string;
  reason: BackupReason;
  createdBy: string | null;
  note: string | null;
  sizeBytes: number;
  tables: number;
  rows: number;
  files: number;
  hasFiles: boolean;
}

/** Backup folder names are their UTC time: 2026-11-08-09-30-00 (plus -2, -3 if two land in the same second). */
const NAME = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(-\d+)?$/;

export function isBackupName(name: string) {
  return NAME.test(name);
}

function dirOf(name: string) {
  if (!isBackupName(name)) throw new Error('Unknown backup.');
  return join(backupRoot(), name);
}

function mysqlQuery(database: string) {
  const db = dbSettings();
  const conn = connectionArgs(db);
  return (sql: string) =>
    run(mysqlTool('mysql'), [...conn.args, '--batch', '--skip-column-names', '--raw', database, '-e', sql], {
      env: conn.env,
    });
}

/** Makes a backup of the database and uploaded files and returns its name. */
export async function createBackup(
  opts: { reason: BackupReason; createdBy?: string | null; note?: string | null; protect?: string[] },
  log: (line: string) => void = () => undefined,
): Promise<{ name: string; manifest: BackupManifest }> {
  const db = dbSettings();
  const conn = connectionArgs(db);
  const query = mysqlQuery(db.name);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let name = stamp;
  for (let i = 2; existsSync(join(backupRoot(), name)); i++) name = `${stamp}-${i}`;
  const dir = join(backupRoot(), name);
  await mkdir(dir, { recursive: true });

  try {
    // Row counts first, for the checks to compare against.
    const countsSql = `SELECT CONCAT('SELECT ', GROUP_CONCAT(CONCAT('''', table_name, ''', (SELECT COUNT(*) FROM \`', table_name, '\`)') SEPARATOR ' UNION ALL SELECT ')) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
    const countQuery = (await query(`SET SESSION group_concat_max_len = 1000000; ${countsSql}`)).trim();
    const tables: Record<string, number> = {};
    if (countQuery && countQuery !== 'NULL')
      for (const line of (await query(countQuery)).trim().split('\n')) {
        const [table, count] = line.split('\t');
        if (table) tables[table] = Number(count);
      }
    const mysqlVersion = (await query('SELECT VERSION()')).trim();

    log('Saving the database…');
    const dumpFile = join(dir, 'database.sql.gz');
    const dump = spawn(
      mysqlTool('mysqldump'),
      [
        ...conn.args,
        '--single-transaction',
        '--quick',
        '--no-tablespaces',
        '--routines',
        '--triggers',
        '--set-gtid-purged=OFF',
        '--default-character-set=utf8mb4',
        db.name,
      ],
      { env: conn.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let dumpErr = '';
    dump.stderr.on('data', (d: Buffer) => (dumpErr += d.toString()));
    const exited = new Promise<number | null>((r) => dump.on('close', r));
    await pipeline(dump.stdout, createGzip({ level: 6 }), createWriteStream(dumpFile));
    const code = await exited;
    if (code !== 0) throw new Error(`mysqldump failed (exit ${code}): ${dumpErr.trim()}`);

    log('Saving uploaded files…');
    const storage = storageRoot();
    const storageFile = join(dir, 'storage.tar.gz');
    if (existsSync(storage)) await run(tarTool(), ['-czf', storageFile, '-C', dirname(storage), basename(storage)]);

    const files: Record<string, string> = { 'database.sql.gz': await sha256File(dumpFile) };
    if (existsSync(storageFile)) files['storage.tar.gz'] = await sha256File(storageFile);

    const manifest: BackupManifest = {
      createdAt: new Date().toISOString(),
      database: db.name,
      mysqlVersion,
      tables,
      files,
      storage: await folderStats(storage),
      reason: opts.reason,
      createdBy: opts.createdBy ?? null,
      note: opts.note?.trim() || null,
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // A second copy somewhere else (another disk, a synced cloud folder): survives this disk failing.
    const copyRoot = process.env.BACKUP_COPY_DIR;
    if (copyRoot) {
      try {
        await cp(dir, join(copyRoot, name), { recursive: true });
      } catch (err) {
        log(`Warning: could not copy the backup to BACKUP_COPY_DIR (${(err as Error).message}).`);
      }
    }

    await pruneBackups(Date.now(), [name, ...(opts.protect ?? [])]);
    return { name, manifest };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Keeps the newest BACKUP_KEEP backups (default 14), plus the newest backup of each of the last
 * BACKUP_KEEP_WEEKS weeks (default 8). The weekly ones matter after a data breach that is only
 * noticed weeks later: there is still a copy from before it.
 */
export async function pruneBackups(now = Date.now(), protect: string[] = []) {
  const keep = Number(process.env.BACKUP_KEEP || 14);
  const weeks = Number(process.env.BACKUP_KEEP_WEEKS || 8);
  const all = (await listBackups()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = new Set([...protect, ...all.slice(0, keep).map((b) => b.name)]);
  const seenWeeks = new Set<number>();
  for (const b of all) {
    const week = Math.floor((now - Date.parse(b.createdAt)) / (7 * 86_400_000));
    if (week < weeks && !seenWeeks.has(week)) {
      seenWeeks.add(week);
      kept.add(b.name);
    }
  }
  for (const b of all) if (!kept.has(b.name)) await rm(join(backupRoot(), b.name), { recursive: true, force: true });
}

export async function readManifest(name: string): Promise<BackupManifest> {
  return JSON.parse(await readFile(join(dirOf(name), 'manifest.json'), 'utf8')) as BackupManifest;
}

/** All complete backups (those with a manifest), newest first. */
export async function listBackups(): Promise<BackupSummary[]> {
  if (!existsSync(backupRoot())) return [];
  const out: BackupSummary[] = [];
  for (const entry of await readdir(backupRoot(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !isBackupName(entry.name)) continue;
    try {
      const m = await readManifest(entry.name);
      let sizeBytes = 0;
      for (const f of Object.keys(m.files)) sizeBytes += (await stat(join(backupRoot(), entry.name, f))).size;
      out.push({
        name: entry.name,
        createdAt: m.createdAt,
        reason: m.reason ?? 'command-line',
        createdBy: m.createdBy ?? null,
        note: m.note ?? null,
        sizeBytes,
        tables: Object.keys(m.tables).length,
        rows: Object.values(m.tables).reduce((a, b) => a + b, 0),
        files: m.storage.files,
        hasFiles: !!m.files['storage.tar.gz'],
      });
    } catch {
      // Unfinished or damaged folder: not offered for restore.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Throws if any file of the backup is missing or has changed since it was made. */
export async function verifyBackup(name: string): Promise<BackupManifest> {
  const manifest = await readManifest(name);
  for (const [file, sum] of Object.entries(manifest.files)) {
    const path = join(dirOf(name), file);
    if (!existsSync(path) || (await sha256File(path)) !== sum)
      throw new Error(`${file} in backup ${name} is missing or damaged, so it cannot be restored.`);
  }
  return manifest;
}

/** Drops every table, so tables added after the backup was made do not linger. */
async function emptyDatabase() {
  const db = dbSettings();
  const query = mysqlQuery(db.name);
  const tables = (
    await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`)
  ).trim();
  if (!tables) return;
  const list = tables
    .split('\n')
    .map((t) => `\`${t.trim()}\``)
    .join(', ');
  await query(`SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS ${list};`);
}

/** Replaces the whole live database with the backup's. */
export async function restoreDatabase(name: string) {
  const db = dbSettings();
  const conn = connectionArgs(db);
  await emptyDatabase();
  await run(mysqlTool('mysql'), [...conn.args, '--default-character-set=utf8mb4', db.name], {
    env: conn.env,
    input: createReadStream(join(dirOf(name), 'database.sql.gz')).pipe(createGunzip()),
  });
}

/**
 * Replaces the uploaded files with the backup's. They are unpacked next to the live folder first and
 * only swapped in once complete, so a failure part-way leaves the current files in place.
 */
export async function restoreFiles(name: string) {
  const archive = join(dirOf(name), 'storage.tar.gz');
  if (!existsSync(archive)) return;
  const storage = storageRoot();
  const parent = dirname(storage);
  const tmp = await mkdtemp(join(parent, '.restoring-'));
  try {
    await run(tarTool(), ['-xzf', archive, '-C', tmp]);
    const unpacked = join(tmp, (await readdir(tmp))[0] ?? '');
    if (!existsSync(unpacked)) throw new Error('The backup of uploaded files is empty.');
    const old = join(parent, `.storage-replaced-${Date.now()}`);
    if (existsSync(storage)) await rename(storage, old);
    await rename(unpacked, storage);
    // The replaced files are in the "before-restore" backup, so the extra copy is not needed.
    await rm(old, { recursive: true, force: true });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Signs everyone out: after a rollback (or a breach) no old session should keep working. */
export async function deleteAllSessions() {
  await mysqlQuery(dbSettings().name)('DELETE FROM sessions');
}

export interface RollbackResult {
  restored: string;
  safetyBackup: string;
  filesRestored: boolean;
}

/**
 * The rollback itself:
 *  1. checks the backup is complete and unchanged;
 *  2. backs up the current state ("before-restore"), so nothing is lost and a breach can still be investigated;
 *  3. replaces the database (and, unless told not to, the uploaded files);
 *  4. if loading fails, puts the state from step 2 back.
 * Afterwards the caller applies newer database updates (migrations) and signs everyone out.
 */
export async function rollback(
  name: string,
  opts: { includeFiles: boolean; createdBy?: string | null },
  log: (line: string) => void = () => undefined,
): Promise<RollbackResult> {
  log('Checking the backup…');
  const manifest = await verifyBackup(name);
  if (manifest.database !== dbSettings().name)
    log(`Note: this backup was made from database "${manifest.database}"; restoring into "${dbSettings().name}".`);

  log('Saving the current state first…');
  const safety = await createBackup(
    {
      reason: 'before-restore',
      createdBy: opts.createdBy,
      note: `Saved automatically before restoring ${name}`,
      protect: [name],
    },
    log,
  );

  try {
    log('Restoring the database…');
    await restoreDatabase(name);
    if (opts.includeFiles) {
      log('Restoring uploaded files…');
      await restoreFiles(name);
    }
  } catch (err) {
    log(`Restore failed (${(err as Error).message}). Putting the previous state back…`);
    await restoreDatabase(safety.name);
    if (opts.includeFiles) await restoreFiles(safety.name).catch(() => undefined);
    throw new Error(`The restore failed and the site was put back as it was. ${(err as Error).message}`);
  }
  return { restored: name, safetyBackup: safety.name, filesRestored: opts.includeFiles && !!manifest.files['storage.tar.gz'] };
}

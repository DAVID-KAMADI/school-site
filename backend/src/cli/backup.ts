/**
 * Backs up the database and the uploaded files into backups/<date-time>/:
 *   database.sql.gz   full dump (consistent snapshot; the site keeps running)
 *   storage.tar.gz    public media and private applicant documents
 *   manifest.json     table row counts, file counts and checksums, used by the restore check
 *
 *   npm run backup
 *
 * Keeps the newest BACKUP_KEEP backups (default 14). Copy the folder off this server too:
 * a backup on the same disk does not survive the disk failing.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import {
  backupRoot,
  connectionArgs,
  dbSettings,
  folderStats,
  loadEnv,
  mysqlTool,
  run,
  sha256File,
  storageRoot,
  tarTool,
  type Manifest,
} from './backup-tools.js';

loadEnv();
const db = dbSettings();
const conn = connectionArgs(db);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const dir = join(backupRoot(), stamp);
await mkdir(dir, { recursive: true });

try {
  // Row counts first, for the restore check to compare against.
  const countsSql = `SELECT CONCAT('SELECT ', GROUP_CONCAT(CONCAT('''', table_name, ''', (SELECT COUNT(*) FROM \`', table_name, '\`)') SEPARATOR ' UNION ALL SELECT ')) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
  const query = (sql: string) =>
    run(
      mysqlTool('mysql'),
      [
        ...conn.args,
        '--batch',
        '--skip-column-names',
        '--raw',
        db.name,
        '-e',
        sql,
      ],
      { env: conn.env },
    );
  const countQuery = (
    await query(`SET SESSION group_concat_max_len = 1000000; ${countsSql}`)
  ).trim();
  const tables: Record<string, number> = {};
  for (const line of (await query(countQuery)).trim().split('\n')) {
    const [name, count] = line.split('\t');
    if (name) tables[name] = Number(count);
  }
  const mysqlVersion = (await query('SELECT VERSION()')).trim();

  // Database dump, gzipped as it streams.
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
  await pipeline(
    dump.stdout,
    createGzip({ level: 6 }),
    createWriteStream(dumpFile),
  );
  const code = await exited;
  if (code !== 0)
    throw new Error(`mysqldump failed (exit ${code}): ${dumpErr.trim()}`);

  // Uploaded files.
  const storage = storageRoot();
  const storageFile = join(dir, 'storage.tar.gz');
  if (existsSync(storage))
    await run(tarTool(), [
      '-czf',
      storageFile,
      '-C',
      dirname(storage),
      basename(storage),
    ]);

  const files: Record<string, string> = {
    'database.sql.gz': await sha256File(dumpFile),
  };
  if (existsSync(storageFile))
    files['storage.tar.gz'] = await sha256File(storageFile);

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    database: db.name,
    mysqlVersion,
    tables,
    files,
    storage: await folderStats(storage),
  };
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  // Retention: keep the newest N backups.
  const keep = Number(process.env.BACKUP_KEEP || 14);
  const all = (await readdir(backupRoot(), { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep)))
    await rm(join(backupRoot(), old), { recursive: true, force: true });

  const rows = Object.values(tables).reduce((a, b) => a + b, 0);
  console.log(`Backup saved to ${dir}`);
  console.log(
    `  ${Object.keys(tables).length} tables, ${rows} rows; ${manifest.storage.files} uploaded files.`,
  );
} catch (err) {
  await rm(dir, { recursive: true, force: true });
  console.error(`Backup FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
}

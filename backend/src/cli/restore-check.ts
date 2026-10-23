/**
 * Proves a backup can actually be restored, without touching the live database:
 * checks the checksums, loads the dump into a separate scratch database, compares
 * tables and row counts with the manifest, unpacks the files and counts them, then cleans up.
 *
 *   npm run backup:check                 (newest backup)
 *   npm run backup:check -- <folder>     (a specific one)
 *
 * The scratch database is RESTORE_CHECK_DB_NAME (default <DB_NAME>_restore_check). Create it once as root:
 *   CREATE DATABASE school_site_training_restore_check CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
 *   GRANT ALL PRIVILEGES ON school_site_training_restore_check.* TO 'school_app'@'localhost';
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGunzip } from 'node:zlib';
import {
  backupRoot,
  connectionArgs,
  dbSettings,
  folderStats,
  loadEnv,
  mysqlTool,
  run,
  sha256File,
  tarTool,
  type Manifest,
} from './backup-tools.js';

loadEnv();
const db = dbSettings();
const scratch = process.env.RESTORE_CHECK_DB_NAME || `${db.name}_restore_check`;
// Safety: this database is emptied, so it must never be the real one.
if (scratch === db.name || !scratch.endsWith('_restore_check')) {
  console.error(
    `Refusing to use "${scratch}": the scratch database name must end in _restore_check and differ from DB_NAME.`,
  );
  process.exit(1);
}
const conn = connectionArgs(db);
const query = (sql: string) =>
  run(
    mysqlTool('mysql'),
    [
      ...conn.args,
      '--batch',
      '--skip-column-names',
      '--raw',
      scratch,
      '-e',
      sql,
    ],
    { env: conn.env },
  );

async function emptyScratch() {
  const tables = (
    await query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`,
    )
  ).trim();
  if (!tables) return;
  const list = tables
    .split('\n')
    .map((t) => `\`${t}\``)
    .join(', ');
  await query(`SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS ${list};`);
}

const arg = process.argv[2];
let dir: string;
if (arg) dir = resolve(arg);
else {
  const names = existsSync(backupRoot())
    ? (await readdir(backupRoot()))
        .filter((n) => /^\d{4}-\d{2}-\d{2}-/.test(n))
        .sort()
    : [];
  if (!names.length) {
    console.error(`No backups in ${backupRoot()}. Run: npm run backup`);
    process.exit(1);
  }
  dir = join(backupRoot(), names.at(-1)!);
}

const problems: string[] = [];
const notes: string[] = [];
let tmp = '';
try {
  console.log(`Checking ${dir}`);
  const manifest = JSON.parse(
    await readFile(join(dir, 'manifest.json'), 'utf8'),
  ) as Manifest;

  // 1. Files are complete and unchanged.
  for (const [file, sum] of Object.entries(manifest.files)) {
    if ((await sha256File(join(dir, file))) !== sum)
      problems.push(
        `${file} does not match its checksum (damaged or changed).`,
      );
  }
  if (problems.length) throw new Error(problems.join(' '));
  console.log('  checksums OK');

  // 2. Database loads into the scratch database.
  try {
    await query('SELECT 1');
  } catch (err) {
    throw new Error(
      `Cannot open the scratch database "${scratch}". Create it once as the MySQL root user:\n` +
        `  CREATE DATABASE ${scratch} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n` +
        `  GRANT ALL PRIVILEGES ON ${scratch}.* TO '${db.user}'@'localhost';\n` +
        `(${(err as Error).message.split('\n').pop()})`,
    );
  }
  await emptyScratch();
  await run(
    mysqlTool('mysql'),
    [...conn.args, '--default-character-set=utf8mb4', scratch],
    {
      env: conn.env,
      input: createReadStream(join(dir, 'database.sql.gz')).pipe(
        createGunzip(),
      ),
    },
  );
  console.log('  database restored into scratch copy');

  // 3. Same tables; row counts match. Busy tables (sessions, audit log) may move slightly
  //    between the count and the dump on a live site, so small differences there are notes.
  const restored: Record<string, number> = {};
  for (const name of Object.keys(manifest.tables)) {
    try {
      restored[name] = Number(
        (await query(`SELECT COUNT(*) FROM \`${name}\``)).trim(),
      );
    } catch {
      problems.push(`Table ${name} is missing after restore.`);
    }
  }
  const busy = new Set(['sessions', 'audit_logs']);
  for (const [name, expected] of Object.entries(manifest.tables)) {
    const got = restored[name];
    if (got === undefined || got === expected) continue;
    if (expected > 0 && got === 0)
      problems.push(
        `Table ${name} is empty after restore (expected ${expected} rows).`,
      );
    else if (busy.has(name))
      notes.push(
        `${name}: ${got} rows (counted ${expected} just before the dump)`,
      );
    else problems.push(`Table ${name} has ${got} rows; expected ${expected}.`);
  }
  const migrations = Number(
    (await query('SELECT COUNT(*) FROM migrations')).trim(),
  );
  console.log(
    `  ${Object.keys(restored).length} tables and ${migrations} migrations restored`,
  );

  // 4. Uploaded files unpack completely.
  if (manifest.files['storage.tar.gz']) {
    tmp = await mkdtemp(join(tmpdir(), 'restore-check-'));
    await run(tarTool(), ['-xzf', join(dir, 'storage.tar.gz'), '-C', tmp]);
    const folder = (await readdir(tmp))[0];
    const stats = await folderStats(join(tmp, folder ?? ''));
    if (
      stats.files !== manifest.storage.files ||
      stats.bytes !== manifest.storage.bytes
    )
      problems.push(
        `Uploaded files: unpacked ${stats.files} files / ${stats.bytes} bytes; expected ${manifest.storage.files} / ${manifest.storage.bytes}.`,
      );
    else
      console.log(
        `  ${stats.files} uploaded files unpacked (${(stats.bytes / 1048576).toFixed(1)} MB)`,
      );
  }

  for (const n of notes) console.log(`  note: ${n}`);
  if (problems.length) throw new Error(problems.join('\n  '));
  console.log(`PASS: backup from ${manifest.createdAt} restores correctly.`);
  console.log(
    `(To restore for real, load database.sql.gz into the live database and unpack storage.tar.gz next to it; see README "Backups".)`,
  );
} catch (err) {
  console.error(`FAIL: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  await emptyScratch().catch(() => undefined);
}

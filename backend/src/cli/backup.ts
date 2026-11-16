/**
 * Backs up the database and the uploaded files into backups/<date-time>/ (see backup/backup-core.ts).
 *
 *   npm run backup
 *   npm run backup -- --note "Before term results upload"
 *
 * The API also makes one every night (BACKUP_HOUR) and super administrators can make one from
 * Admin → Backups & restore. Retention: BACKUP_KEEP newest plus one a week for BACKUP_KEEP_WEEKS.
 * Set BACKUP_COPY_DIR to keep a second copy on another disk: a backup on the same disk does not
 * survive the disk failing.
 */
import { createBackup } from '../backup/backup-core.js';
import { loadEnv } from './backup-tools.js';

loadEnv();
const noteAt = process.argv.indexOf('--note');
const note = noteAt > 0 ? (process.argv[noteAt + 1] ?? null) : null;

try {
  const { name, manifest } = await createBackup({ reason: 'command-line', note }, (l) => console.log(`  ${l}`));
  const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
  console.log(`Backup saved: ${name}`);
  console.log(`  ${Object.keys(manifest.tables).length} tables, ${rows} rows; ${manifest.storage.files} uploaded files.`);
} catch (err) {
  console.error(`Backup FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
}

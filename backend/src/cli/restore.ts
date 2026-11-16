/**
 * Rolls the site back to a backup from the command line, for when the admin portal cannot be used
 * (e.g. the database is damaged). Normally use Admin → Backups & restore instead.
 *
 *   npm run restore                         lists the backups
 *   npm run restore -- <backup> --yes       restores one (database and uploaded files)
 *   npm run restore -- <backup> --yes --database-only
 *
 * STOP THE API FIRST: it must not write to the database while it is replaced. What happens:
 * the backup is checked, the current state is saved as a "before-restore" backup, the database
 * (and files) are replaced, newer database updates are applied, and everyone is signed out.
 * If loading fails, the saved state is put back.
 */
import { DataSource } from 'typeorm';
import { deleteAllSessions, listBackups, rollback } from '../backup/backup-core.js';
import { databaseOptions } from '../config/database.config.js';
import { loadEnv } from './backup-tools.js';

loadEnv();
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));

const backups = await listBackups();
if (!name) {
  console.log('Backups (newest first):');
  for (const b of backups)
    console.log(
      `  ${b.name}  ${b.reason.padEnd(14)} ${(b.sizeBytes / 1048576).toFixed(1).padStart(7)} MB  ${b.note ?? ''}`,
    );
  if (!backups.length) console.log('  (none yet: npm run backup)');
  console.log('\nRestore one with: npm run restore -- <backup> --yes   (stop the API first)');
  process.exit(0);
}
if (!backups.some((b) => b.name === name)) {
  console.error(`No backup called "${name}". Run "npm run restore" to list them.`);
  process.exit(1);
}
if (!args.includes('--yes')) {
  console.error(
    `This replaces the whole database${args.includes('--database-only') ? '' : ' and the uploaded files'} with backup ${name}.\n` +
      'Stop the API first, then run again with --yes to go ahead.',
  );
  process.exit(1);
}

try {
  const result = await rollback(
    name,
    { includeFiles: !args.includes('--database-only'), createdBy: 'command line' },
    (l) => console.log(`  ${l}`),
  );
  console.log('  Applying database updates made since the backup…');
  const ds = new DataSource({ ...databaseOptions(), entities: [] });
  await ds.initialize();
  try {
    const applied = await ds.runMigrations({ transaction: 'each' });
    if (applied.length) console.log(`  ${applied.length} update(s) applied.`);
  } finally {
    await ds.destroy();
  }
  console.log('  Signing everyone out…');
  await deleteAllSessions();
  console.log(`Restored backup ${name}.`);
  console.log(`The state before the restore is saved as backup ${result.safetyBackup}.`);
  console.log('Start the API again. Everyone must sign in again.');
} catch (err) {
  console.error(`RESTORE FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
}

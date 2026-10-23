/** Shared helpers for the backup and restore-check commands. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export function loadEnv() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: settings come from the real environment (production).
  }
}

export interface DbSettings {
  host: string;
  port: string;
  name: string;
  user: string;
  password: string;
}

export function dbSettings(): DbSettings {
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  if (!name || !user) throw new Error('DB_NAME and DB_USER must be set.');
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || '3306',
    name,
    user,
    password: process.env.DB_PASSWORD || '',
  };
}

/** Finds mysql/mysqldump: MYSQL_BIN_DIR, then the usual Windows install folder, then PATH. */
export function mysqlTool(tool: 'mysql' | 'mysqldump'): string {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool;
  if (process.env.MYSQL_BIN_DIR) return join(process.env.MYSQL_BIN_DIR, exe);
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\MySQL';
    if (existsSync(base)) {
      const server = readdirSync(base)
        .filter((d) => d.startsWith('MySQL Server'))
        .sort()
        .pop();
      if (server && existsSync(join(base, server, 'bin', exe)))
        return join(base, server, 'bin', exe);
    }
  }
  return tool;
}

/** Windows' own tar (bsdtar); Git's GNU tar misreads "C:\..." as a remote host. */
export function tarTool(): string {
  if (process.platform !== 'win32') return 'tar';
  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

/** Connection arguments; the password goes in MYSQL_PWD so it never shows in the process list. */
export function connectionArgs(db: DbSettings) {
  return {
    args: [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.user}`],
    env: { ...process.env, MYSQL_PWD: db.password },
  };
}

/** Runs a command, resolving with stdout; rejects with stderr on failure. */
export function run(
  cmd: string,
  args: string[],
  opts: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    input?: NodeJS.ReadableStream;
  } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      env: opts.env,
      cwd: opts.cwd,
      stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    if (opts.input) opts.input.pipe(child.stdin!);
    child.on('error', (e) =>
      reject(new Error(`Could not run ${cmd}: ${e.message}`)),
    );
    child.on('close', (code) =>
      code === 0
        ? resolvePromise(out)
        : reject(new Error(`${cmd} failed (exit ${code}): ${err.trim()}`)),
    );
  });
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('error', reject)
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Number of files and total bytes under a folder. */
export async function folderStats(
  dir: string,
): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  if (!existsSync(dir)) return { files, bytes };
  for (const entry of await readdir(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile()) continue;
    files++;
    bytes += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return { files, bytes };
}

export function backupRoot(): string {
  return resolve(process.env.BACKUP_DIR || 'backups');
}

export function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR || 'storage');
}

export interface Manifest {
  createdAt: string;
  database: string;
  mysqlVersion: string;
  tables: Record<string, number>;
  files: Record<string, string>;
  storage: { files: number; bytes: number };
}

import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from '../database/snake-naming.strategy.js';

const REQUIRED = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
] as const;

export function databaseOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing database settings in .env: ${missing.join(', ')}`);
  }

  return {
    type: 'mysql',
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    // Schema changes only ever happen through migrations, never automatic sync.
    synchronize: false,
    namingStrategy: new SnakeNamingStrategy(),
    migrations: [`${import.meta.dirname}/../database/migrations/*.js`],
  };
}

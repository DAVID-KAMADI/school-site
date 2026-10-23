// Used by the TypeORM CLI (npm run migration:*). Runs from the compiled dist folder.
import 'reflect-metadata';
import { databaseOptions } from '../config/database.config.js';
import { UtcDataSource } from './utc-data-source.js';

process.loadEnvFile?.();

export default new UtcDataSource({
  ...databaseOptions(),
  entities: [`${import.meta.dirname}/../**/*.entity.js`],
});

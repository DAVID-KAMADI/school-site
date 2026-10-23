/**
 * Rebuilds the resized copies of every image in the media library.
 * Run after changing the responsive image sizes:  npm run media:regenerate
 * Pages, links, alt text and the original files are not changed.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { MediaService } from '../cms/media/media.service.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const ids: { id: number }[] = await app
    .get(DataSource)
    .query(
      "SELECT id FROM media WHERE mime_type LIKE 'image/%' AND deleted_at IS NULL",
    );
  const media = app.get(MediaService);
  let done = 0;
  for (const { id } of ids) {
    try {
      await media.regenerateVariants(id);
      done++;
    } catch (err) {
      console.warn(`Image ${id}: ${(err as Error).message}`);
    }
  }
  console.log(`Rebuilt resized copies for ${done} of ${ids.length} images.`);
} finally {
  await app.close();
}

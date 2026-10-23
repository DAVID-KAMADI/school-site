import { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers.js';
import request from 'supertest';
import { App } from 'supertest/types.js';

// Needs the local training database running (see ../database/setup-local.example.sql).
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createTestApp();
  });

  it('/health (GET) reports the database is up', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
  });

  afterEach(async () => {
    await app.close();
  });
});

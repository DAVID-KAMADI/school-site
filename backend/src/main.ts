import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { MediaStorage } from './cms/media/storage.js';
import { productionCheck } from './config/production-check.js';

async function bootstrap() {
  const { errors, warnings } = productionCheck();
  for (const w of warnings) console.warn(`[production check] ${w}`);
  if (errors.length) {
    console.error(
      [
        'Refusing to start in production:',
        ...errors.map((e) => `  - ${e}`),
        'See README "Going live".',
      ].join('\n'),
    );
    process.exit(1);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind a reverse proxy in production, set TRUST_PROXY (e.g. "1") so req.ip is the visitor's address.
  if (process.env.TRUST_PROXY)
    app.set(
      'trust proxy',
      Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY,
    );
  app.use(helmet());
  // Uploaded public media (images, downloads). Long cache: file names are unique and never reused.
  app.useStaticAssets(new MediaStorage().publicRoot, {
    prefix: '/media',
    maxAge: '365d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
  });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:4200',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionsModule } from './admissions/admissions.module.js';
import { AuditModule } from './audit/audit.module.js';
import { BlogModule } from './blog/blog.module.js';
import { CmsModule } from './cms/cms.module.js';
import { DashboardModule } from './dashboard/dashboard.controller.js';
import { databaseOptions } from './config/database.config.js';
import { UtcDataSource } from './database/utc-data-source.js';
import { HealthController } from './health/health.controller.js';
import { CsrfMiddleware } from './identity/csrf.middleware.js';
import { PermissionsGuard, SessionGuard } from './identity/guards.js';
import { IdentityModule } from './identity/identity.module.js';
import { TimetableModule } from './timetable/timetable.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({ ...databaseOptions(), autoLoadEntities: true }),
      dataSourceFactory: (options) => new UtcDataSource(options!).initialize(),
    }),
    ThrottlerModule.forRoot([{ name: 'default', limit: 300, ttl: 60_000 }]),
    ScheduleModule.forRoot(),
    AuditModule,
    IdentityModule,
    CmsModule,
    BlogModule,
    AdmissionsModule,
    DashboardModule,
    TimetableModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate limit first, then sign-in, then permissions.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*path');
  }
}

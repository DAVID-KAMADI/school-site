import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CmsModule } from '../cms/cms.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { BackupController, MaintenanceMiddleware } from './backup.controller.js';
import { BackupService } from './backup.service.js';

/** Backups, rollback and the nightly backup. */
@Module({
  imports: [IdentityModule, CmsModule],
  controllers: [BackupController],
  providers: [BackupService, MaintenanceMiddleware],
  exports: [BackupService],
})
export class BackupModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MaintenanceMiddleware).forRoutes('*path');
  }
}

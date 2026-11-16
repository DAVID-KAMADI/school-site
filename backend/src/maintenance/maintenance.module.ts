import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BackupModule } from '../backup/backup.module.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { MaintenanceAdminController, MaintenanceStatusController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

/** Maintenance mode and the public "is the site under maintenance?" status. */
@Module({
  imports: [TypeOrmModule.forFeature([SiteSetting]), BackupModule],
  controllers: [MaintenanceStatusController, MaintenanceAdminController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}

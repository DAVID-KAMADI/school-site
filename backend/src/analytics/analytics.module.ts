import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { AnalyticsSettingsService } from './analytics-settings.service.js';
import { AdminAnalyticsController, PublicAnalyticsController } from './analytics.controller.js';
import { ANALYTICS_ENTITIES } from './analytics.entities.js';
import { CollectService } from './collect.service.js';
import { GeoService } from './geo.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Web analytics: the website's tracker sends page views and events to public/analytics/collect;
 * Admin → Web analytics reads the reports from admin/analytics/*.
 */
@Module({
  imports: [TypeOrmModule.forFeature([...ANALYTICS_ENTITIES, SiteSetting])],
  controllers: [PublicAnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsSettingsService, CollectService, GeoService, ReportsService],
})
export class AnalyticsModule {}

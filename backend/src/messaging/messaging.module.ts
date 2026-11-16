import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdmissionsModule } from '../admissions/admissions.module.js';
import { ApplicationEvent } from '../admissions/entities/application-event.entity.js';
import { Application } from '../admissions/entities/application.entity.js';
import { DocumentType } from '../admissions/entities/document-type.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { FollowUpsService } from './follow-ups.service.js';
import { MessageLog } from './message-log.entity.js';
import { FollowUpsController, MessagingSettingsController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';

/** SMS (Africa's Talking) and email (SMTP): settings, test messages, applicant follow-ups and the message log. */
@Module({
  imports: [
    TypeOrmModule.forFeature([MessageLog, SiteSetting, Application, ApplicationEvent, DocumentType, User]),
    AdmissionsModule,
  ],
  controllers: [MessagingSettingsController, FollowUpsController],
  providers: [MessagingService, FollowUpsService],
  exports: [MessagingService],
})
export class MessagingModule {}

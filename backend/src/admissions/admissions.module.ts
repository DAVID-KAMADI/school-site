import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Media } from '../cms/entities/media.entity.js';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { CmsModule } from '../cms/cms.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import {
  AdminApplicationsController,
  AdmissionsSetupController,
  PublicAdmissionsController,
} from './admin-applications.controller.js';
import { AdmissionsConfigService } from './admissions-config.service.js';
import { ApplicantController } from './applicant.controller.js';
import { ApplicantsController } from './applicants.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ApplicationsReportService } from './applications-report.service.js';
import { LetterheadService } from './letterhead.service.js';
import { OfferLetterService } from './offer-letter.service.js';
import { ApplicationDocument } from './entities/application-document.entity.js';
import { ApplicationEvent } from './entities/application-event.entity.js';
import { Application } from './entities/application.entity.js';
import { DocumentType } from './entities/document-type.entity.js';
import { Intake } from './entities/intake.entity.js';
import { Programme } from './entities/programme.entity.js';
import { ShortCourse } from './entities/short-course.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Programme,
      ShortCourse,
      Intake,
      DocumentType,
      Application,
      ApplicationDocument,
      ApplicationEvent,
      SiteSetting,
      Media,
    ]),
    IdentityModule,
    CmsModule,
  ],
  controllers: [
    ApplicantController,
    AdminApplicationsController,
    AdmissionsSetupController,
    PublicAdmissionsController,
    ApplicantsController,
  ],
  providers: [
    AdmissionsConfigService,
    ApplicationsService,
    OfferLetterService,
    LetterheadService,
    ApplicationsReportService,
  ],
  exports: [AdmissionsConfigService, ApplicationsService],
})
export class AdmissionsModule {}

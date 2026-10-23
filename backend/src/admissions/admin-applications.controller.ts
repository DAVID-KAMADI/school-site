import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service.js';
import { can, type AuthUser } from '../identity/auth-user.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
  SETUP_PERMISSIONS,
} from '../identity/decorators.js';
import { AdmissionsConfigService } from './admissions-config.service.js';
import { ApplicationsReportService } from './applications-report.service.js';
import { ApplicationsService } from './applications.service.js';
import { DocumentReviewStatus } from './entities/application-document.entity.js';
import { ApplicationStatus, FeeStatus } from './entities/application.entity.js';
import { sendPdf, sendPrivateFile } from './file-response.js';

class ListQuery {
  @IsOptional() @IsEnum(ApplicationStatus) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() programmeId?: number;
  @IsOptional() @Type(() => Number) @IsInt() intakeId?: number;
  @IsOptional() @IsEnum(FeeStatus) fee?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

class StatusDto {
  @IsEnum(ApplicationStatus) status: ApplicationStatus;
  @IsOptional() @IsString() @MaxLength(4000) message?: string;
}

class NoteDto {
  @IsString() @Length(1, 4000) message: string;
  @IsBoolean() visibleToApplicant: boolean;
}

class DocumentReviewDto {
  @IsEnum(DocumentReviewStatus) status: DocumentReviewStatus;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class FeeDto {
  @IsIn([FeeStatus.Verified, FeeStatus.Unpaid]) status:
    FeeStatus.Verified | FeeStatus.Unpaid;
}

/** Admissions officers' screens. */
@Controller('admin/applications')
@RequirePermissions('applications.view')
export class AdminApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly report: ApplicationsReportService,
  ) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.applications.list(q);
  }

  @Get('counts')
  counts() {
    return this.applications.counts();
  }

  @Get('export.csv')
  async export(@Query() q: ListQuery, @Res() res: Response) {
    const csv = await this.applications.exportCsv(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send('﻿' + csv);
  }

  /** The same list as a printable PDF on the institution letterhead. */
  @Get('export.pdf')
  async exportPdf(@Query() q: ListQuery, @Res() res: Response) {
    const rows = await this.applications.exportRows(q);
    const pdf = await this.report.render(rows, q);
    sendPdf(res, {
      pdf,
      name: `applications-${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.applications.staffView(id);
  }

  @Get(':id/offer-letter.pdf')
  async offerLetter(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.applications.offerLetterFor(id));
  }

  @Get(':id/documents/:docId/file')
  async file(
    @Param('docId', ParseIntPipe) docId: number,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    sendPrivateFile(
      res,
      await this.applications.openDocument(docId, {
        userId: user.id,
        isStaff: true,
      }),
    );
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('applications.review')
  status(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.changeStatus(
      id,
      dto.status,
      dto.message,
      user.id,
      can(user, 'applications.decide'),
    );
  }

  @Post(':id/notes')
  @HttpCode(200)
  @RequirePermissions('applications.review')
  note(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: NoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.addNote(
      id,
      dto.message,
      dto.visibleToApplicant,
      user.id,
    );
  }

  @Patch(':id/documents/:docId')
  @RequirePermissions('applications.review')
  reviewDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('docId', ParseIntPipe) docId: number,
    @Body() dto: DocumentReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.reviewDocument(
      id,
      docId,
      dto.status,
      dto.note,
      user.id,
    );
  }

  @Post(':id/fee')
  @HttpCode(200)
  @RequirePermissions('applications.review')
  fee(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.setFee(id, dto.status, user.id);
  }
}

/**
 * Admissions setup. Each area (programmes, short courses, intakes, required documents) has its own
 * create, edit and delete permission, set per role in Access control. Lists are readable by anyone
 * who works in that area; programmes and intakes also by people who view applications (for filters).
 */
@Controller('admin/admissions')
export class AdmissionsSetupController {
  constructor(
    private readonly config: AdmissionsConfigService,
    private readonly audit: AuditService,
  ) {}

  private record(
    actor: AuthUser,
    req: Request,
    action: string,
    entityType: string,
    entityId: number,
    details?: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      userId: actor.id,
      entityType,
      entityId,
      details,
      ipAddress: req.ip,
    });
  }

  @Get('programmes')
  @RequireAnyPermission(...SETUP_PERMISSIONS.programmes, 'applications.view')
  programmes() {
    return this.config.listProgrammes();
  }

  @Post('programmes')
  @RequirePermissions('programmes.create')
  createProgramme(@Body() body: unknown) {
    return this.config.saveProgramme(null, body);
  }

  @Put('programmes/:id')
  @RequirePermissions('programmes.edit')
  updateProgramme(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.config.saveProgramme(id, body);
  }

  @Delete('programmes/:id')
  @HttpCode(200)
  @RequirePermissions('programmes.delete')
  async deleteProgramme(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.config.deleteProgramme(id);
    await this.record(actor, req, 'programme.delete', 'programme', id, gone);
    return { ok: true };
  }

  @Get('short-courses')
  @RequireAnyPermission(...SETUP_PERMISSIONS.shortCourses)
  shortCourses() {
    return this.config.listShortCourses();
  }

  @Post('short-courses')
  @RequirePermissions('short_courses.create')
  createShortCourse(@Body() body: unknown) {
    return this.config.saveShortCourse(null, body);
  }

  @Put('short-courses/:id')
  @RequirePermissions('short_courses.edit')
  updateShortCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.config.saveShortCourse(id, body);
  }

  @Delete('short-courses/:id')
  @HttpCode(204)
  @RequirePermissions('short_courses.delete')
  async deleteShortCourse(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    await this.config.deleteShortCourse(id);
    await this.record(actor, req, 'short_course.delete', 'short_course', id);
  }

  @Get('intakes')
  @RequireAnyPermission(...SETUP_PERMISSIONS.intakes, 'applications.view')
  intakes() {
    return this.config.listIntakes();
  }

  @Post('intakes')
  @RequirePermissions('intakes.create')
  createIntake(@Body() body: unknown) {
    return this.config.saveIntake(null, body);
  }

  @Put('intakes/:id')
  @RequirePermissions('intakes.edit')
  updateIntake(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.config.saveIntake(id, body);
  }

  @Delete('intakes/:id')
  @HttpCode(200)
  @RequirePermissions('intakes.delete')
  async deleteIntake(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.config.deleteIntake(id);
    await this.record(actor, req, 'intake.delete', 'intake', id, gone);
    return { ok: true };
  }

  @Get('document-types')
  @RequireAnyPermission(...SETUP_PERMISSIONS.documentTypes)
  documentTypes() {
    return this.config.listDocumentTypes();
  }

  @Post('document-types')
  @RequirePermissions('document_types.create')
  createDocumentType(@Body() body: unknown) {
    return this.config.saveDocumentType(null, body);
  }

  @Put('document-types/:id')
  @RequirePermissions('document_types.edit')
  updateDocumentType(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.config.saveDocumentType(id, body);
  }

  @Delete('document-types/:id')
  @HttpCode(200)
  @RequirePermissions('document_types.delete')
  async deleteDocumentType(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const gone = await this.config.deleteDocumentType(id);
    await this.record(
      actor,
      req,
      'document_type.delete',
      'document_type',
      id,
      gone,
    );
    return { ok: true };
  }
}

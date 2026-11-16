import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../identity/auth-user.js';
import { CurrentUser, RequirePermissions } from '../identity/decorators.js';
import { SUPER_ADMIN_ROLE } from '../identity/users.service.js';
import { type FollowUpStage, FollowUpsService } from './follow-ups.service.js';
import { MessagingService } from './messaging.service.js';

const STAGES = ['draft', 'info_requested', 'not_started'] as const;

class SmsSettingsDto {
  @IsString() @MaxLength(100) username: string;
  /** Empty keeps the saved key. */
  @IsOptional() @IsString() @MaxLength(200) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(20) senderId?: string;
  @IsIn(['sandbox', 'live']) environment: 'sandbox' | 'live';
}

class EmailSettingsDto {
  @IsString() @MaxLength(200) host: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) port: number;
  @IsIn(['tls', 'starttls', 'none']) security: 'tls' | 'starttls' | 'none';
  @IsOptional() @IsString() @MaxLength(200) username?: string;
  /** Empty keeps the saved password. */
  @IsOptional() @IsString() @MaxLength(300) password?: string;
  @IsOptional() @IsString() @MaxLength(120) fromName?: string;
  @IsString() @MaxLength(200) fromEmail: string;
  @IsOptional() @IsString() @MaxLength(200) replyTo?: string;
}

class TestSmsDto {
  @IsString() @MaxLength(30) to: string;
  @IsString() @MaxLength(480) message: string;
}

class TestEmailDto {
  @IsString() @MaxLength(200) to: string;
}

class FollowUpTextDto {
  @IsOptional() @IsString() @MaxLength(480) smsText?: string;
  @IsOptional() @IsString() @MaxLength(200) emailSubject?: string;
  @IsOptional() @IsString() @MaxLength(5000) emailBody?: string;
}

class SendFollowUpDto extends FollowUpTextDto {
  @IsIn(STAGES) stage: FollowUpStage;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(300) @IsInt({ each: true }) userIds: number[];
  @IsArray() @ArrayNotEmpty() @IsIn(['sms', 'email'], { each: true }) channels: ('sms' | 'email')[];
}

class PreviewFollowUpDto extends FollowUpTextDto {
  @IsIn(STAGES) stage: FollowUpStage;
  @Type(() => Number) @IsInt() userId: number;
}

/** SMS & email settings: super administrators only (they hold the provider's API key and mail password). */
@Controller('admin/messaging')
@RequirePermissions('admin.access')
export class MessagingSettingsController {
  constructor(private readonly messaging: MessagingService) {}

  private only(user: AuthUser) {
    if (!user.roles.includes(SUPER_ADMIN_ROLE))
      throw new ForbiddenException('Only super administrators can change the SMS and email settings.');
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    this.only(user);
    return this.messaging.view();
  }

  @Put('settings/sms')
  saveSms(@Body() dto: SmsSettingsDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    this.only(user);
    return this.messaging.saveSms(dto, user.id, req.ip ?? null);
  }

  @Put('settings/email')
  saveEmail(@Body() dto: EmailSettingsDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    this.only(user);
    return this.messaging.saveEmail(dto, user.id, req.ip ?? null);
  }

  /** Sends a real SMS with the saved settings and shows what Africa's Talking answered. */
  @Post('test-sms')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testSms(@Body() dto: TestSmsDto, @CurrentUser() user: AuthUser) {
    this.only(user);
    return this.messaging.sms(dto.to, dto.message, { purpose: 'test', sentById: user.id });
  }

  @Post('test-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testEmail(@Body() dto: TestEmailDto, @CurrentUser() user: AuthUser) {
    this.only(user);
    return this.messaging.email(
      dto.to.trim(),
      'Test email from the website',
      `Hello,\n\nThis is a test email sent by ${user.fullName} from the website's SMS & email settings.\n\nIf you can read this, email sending works.`,
      { purpose: 'test', sentById: user.id },
    );
  }
}

/** Admissions → Follow-ups: for staff who manage applicants. */
@Controller('admin/follow-ups')
@RequirePermissions('applicants.manage')
export class FollowUpsController {
  constructor(
    private readonly followUps: FollowUpsService,
    private readonly messaging: MessagingService,
  ) {}

  @Get()
  async list(
    @Query('stage') stage: string = 'draft',
    @Query('intakeId') intakeId?: string,
    @Query('inactiveDays') inactiveDays?: string,
    @Query('search') search?: string,
  ) {
    const s = (STAGES as readonly string[]).includes(stage) ? (stage as FollowUpStage) : 'draft';
    const [people, settings] = await Promise.all([
      this.followUps.list({
        stage: s,
        intakeId: Number(intakeId) || undefined,
        inactiveDays: Number(inactiveDays) || undefined,
        search: search?.slice(0, 100),
      }),
      this.messaging.view(),
    ]);
    // The page shows the 500 most recently active; filters narrow it down.
    return { people: people.slice(0, 500), total: people.length, channels: { sms: settings.sms.ready, email: settings.email.ready } };
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewFollowUpDto) {
    return this.followUps.preview(dto.stage, dto.userId, dto);
  }

  @Post('send')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  send(@Body() dto: SendFollowUpDto, @CurrentUser() user: AuthUser) {
    return this.followUps.send(dto, user.id);
  }

  @Get('history')
  history() {
    return this.messaging.history();
  }
}

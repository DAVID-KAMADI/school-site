import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsInt,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AccountType } from '../identity/entities/user.entity.js';
import {
  DAY,
  HOUR,
  MINUTE,
  UserThrottle,
} from '../identity/user-throttle.js';
import { authConfig, SESSION_COOKIE } from '../config/auth.config.js';
import type { AuthUser } from '../identity/auth-user.js';
import { AuthService } from '../identity/auth.service.js';
import {
  CurrentUser,
  Public,
  RequirePermissions,
} from '../identity/decorators.js';
import {
  MIN_PASSWORD_LENGTH,
  UsersService,
} from '../identity/users.service.js';
import { AdmissionsConfigService } from './admissions-config.service.js';
import {
  ApplicationsService,
  type UploadedFile as File,
} from './applications.service.js';
import { sendPdf, sendPrivateFile } from './file-response.js';

class RegisterDto {
  @IsString() @Length(3, 150) fullName: string;
  @IsEmail() @MaxLength(191) email: string;
  @Matches(/^\+?[0-9 ]{9,16}$/, {
    message: 'Enter a valid phone number, e.g. 0712 345 678.',
  })
  phone: string;
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
  })
  @MaxLength(200)
  password: string;
  @Equals(true, {
    message:
      'Please agree to the Terms of Service and Privacy Policy to create an account.',
  })
  acceptTerms: boolean;
}

class UploadDto {
  @Type(() => Number) @IsInt() documentTypeId: number;
}

class SubmitDto {
  @Equals(true, {
    message: 'Please confirm the declaration before submitting.',
  })
  declaration: boolean;
}

class FeeDto {
  @IsString() @Length(6, 20) reference: string;
}

class MessageDto {
  @IsString() @Length(2, 2000) message: string;
}

const upload = FileInterceptor('file', {
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

/** The applicant portal API (/apply on the website). */
@Controller('applicant')
@RequirePermissions('applications.apply')
export class ApplicantController {
  private readonly config = authConfig();

  constructor(
    private readonly applications: ApplicationsService,
    private readonly admissions: AdmissionsConfigService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  /** Programmes, open intakes, required documents and fee information. Public so the /apply page can show them. */
  @Public()
  @Get('options')
  options() {
    return this.admissions.options();
  }

  /** Creates an applicant account and signs the applicant in. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (await this.users.findByEmailWithSecrets(dto.email)) {
      throw new ConflictException(
        'An account with this email already exists. Sign in instead.',
      );
    }
    const user = await this.users.create({
      email: dto.email,
      fullName: dto.fullName,
      phone: dto.phone.replace(/\s/g, ''),
      password: dto.password,
      accountType: AccountType.Applicant,
    });
    await this.users.setRoles(user.id, [{ roleKey: 'applicant' }]);
    await this.users.recordTermsAcceptance(
      user.id,
      String(
        await this.admissions.setting('legal.terms_version', 'unversioned'),
      ),
    );
    const result = await this.auth.login(dto.email, dto.password, {
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.secureCookies,
      path: '/',
      maxAge: this.config.maxSessionHours * 3_600_000,
    });
    return { user: result.user };
  }

  @Get('application')
  application(@CurrentUser() user: AuthUser) {
    return this.applications.applicantView(user.id);
  }

  @UserThrottle({ limit: 30, ttl: MINUTE })
  @Put('application/sections/:key')
  saveSection(
    @Param('key') key: string,
    @Body() body: { data?: unknown },
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.saveSection(user.id, key, body?.data ?? {});
  }

  // Up to 20 MB each: enough for a full set of documents and re-tries, not for filling the disk.
  @UserThrottle({ limit: 10, ttl: MINUTE }, { limit: 30, ttl: HOUR }, { limit: 60, ttl: DAY })
  @Post('application/documents')
  @UseInterceptors(upload)
  uploadDocument(
    @UploadedFile() file: File,
    @Body() dto: UploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.uploadDocument(user.id, dto.documentTypeId, file);
  }

  @UserThrottle({ limit: 20, ttl: MINUTE })
  @Delete('application/documents/:id')
  deleteDocument(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applications.deleteDocument(user.id, id);
  }

  @Get('application/documents/:id/file')
  async file(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    sendPrivateFile(
      res,
      await this.applications.openDocument(id, {
        userId: user.id,
        isStaff: false,
      }),
    );
  }

  @UserThrottle({ limit: 5, ttl: MINUTE })
  @Post('application/submit')
  @HttpCode(200)
  submit(@Body() dto: SubmitDto, @CurrentUser() user: AuthUser) {
    return this.applications.submit(user.id, dto.declaration);
  }

  @UserThrottle({ limit: 5, ttl: MINUTE }, { limit: 20, ttl: DAY })
  @Post('application/fee')
  @HttpCode(200)
  fee(@Body() dto: FeeDto, @CurrentUser() user: AuthUser) {
    return this.applications.reportFee(user.id, dto.reference);
  }

  // Each message reaches the admissions team.
  @UserThrottle({ limit: 5, ttl: MINUTE }, { limit: 30, ttl: DAY })
  @Post('application/messages')
  @HttpCode(200)
  message(@Body() dto: MessageDto, @CurrentUser() user: AuthUser) {
    return this.applications.applicantMessage(user.id, dto.message);
  }

  @UserThrottle({ limit: 5, ttl: MINUTE })
  @Post('application/offer/accept')
  @HttpCode(200)
  acceptOffer(@CurrentUser() user: AuthUser) {
    return this.applications.respondToOffer(user.id, true);
  }

  @UserThrottle({ limit: 5, ttl: MINUTE })
  @Post('application/offer/decline')
  @HttpCode(200)
  declineOffer(@CurrentUser() user: AuthUser) {
    return this.applications.respondToOffer(user.id, false);
  }

  @Get('application/offer-letter.pdf')
  async offerLetter(@CurrentUser() user: AuthUser, @Res() res: Response) {
    sendPdf(res, await this.applications.applicantOfferLetter(user.id));
  }

  @UserThrottle({ limit: 5, ttl: MINUTE }, { limit: 10, ttl: DAY })
  @Post('application/new')
  @HttpCode(200)
  startNew(@CurrentUser() user: AuthUser) {
    return this.applications.startNew(user.id);
  }

  @UserThrottle({ limit: 5, ttl: MINUTE })
  @Post('application/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: AuthUser) {
    return this.applications.withdraw(user.id);
  }
}

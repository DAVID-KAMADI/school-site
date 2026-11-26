import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../identity/decorators.js';
import { PasswordResetService } from './password-reset.service.js';

class ForgotDto {
  @IsEmail({}, { message: 'Enter the email address you registered with.' })
  @MaxLength(191)
  email: string;
}

class TokenDto {
  @IsString() @MaxLength(100) token: string;
}

class ResetDto extends TokenDto {
  @IsString() @MaxLength(200) password: string;
}

/** Same reply for every email, registered or not. */
const SENT_REPLY =
  'If that email belongs to an applicant or student account, a link to reset the password is on its way. Check your inbox (and spam folder). The link works for 30 minutes.';

/** "Forgot your password" on the applicant/student sign-in (/apply). */
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @Post('request')
  @HttpCode(200)
  request(@Body() dto: ForgotDto, @Req() req: Request) {
    this.resets.request(dto.email, req.ip ?? null);
    return { message: SENT_REPLY };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 15 * 60_000 } })
  @Post('check')
  @HttpCode(200)
  check(@Body() dto: TokenDto) {
    return this.resets.check(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @Post('reset')
  @HttpCode(200)
  async reset(@Body() dto: ResetDto, @Req() req: Request) {
    await this.resets.reset(dto.token, dto.password, req.ip ?? null);
    return { ok: true };
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteSetting } from '../cms/entities/site-setting.entity.js';
import { PasswordReset } from '../identity/entities/password-reset.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { IdentityModule } from '../identity/identity.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { PasswordResetController } from './password-reset.controller.js';
import { PasswordResetService } from './password-reset.service.js';

/** "Forgot your password" links for applicants and students. */
@Module({
  imports: [
    TypeOrmModule.forFeature([PasswordReset, User, SiteSetting]),
    IdentityModule,
    MessagingModule,
  ],
  controllers: [PasswordResetController],
  providers: [PasswordResetService],
})
export class AccountRecoveryModule {}

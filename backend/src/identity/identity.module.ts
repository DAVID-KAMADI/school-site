import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { Permission } from './entities/permission.entity.js';
import { PortalAccessKeyUser } from './entities/portal-access-key-user.entity.js';
import { PortalAccessKey } from './entities/portal-access-key.entity.js';
import { PortalAccessLog } from './entities/portal-access-log.entity.js';
import { Role } from './entities/role.entity.js';
import { Session } from './entities/session.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import {
  PortalAccessController,
  PortalKeysController,
} from './portal-access.controller.js';
import { PortalAccessService } from './portal-access.service.js';
import { SessionsService } from './sessions.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Role,
      Permission,
      UserRole,
      Session,
      PortalAccessKey,
      PortalAccessKeyUser,
      PortalAccessLog,
    ]),
  ],
  controllers: [
    AuthController,
    UsersController,
    AccessController,
    PortalAccessController,
    PortalKeysController,
  ],
  providers: [
    UsersService,
    SessionsService,
    AuthService,
    AccessService,
    PortalAccessService,
  ],
  exports: [TypeOrmModule, UsersService, SessionsService, AuthService],
})
export class IdentityModule {}

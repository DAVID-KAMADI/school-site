import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessController } from './access.controller.js';
import { AccessService } from './access.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { Permission } from './entities/permission.entity.js';
import { Role } from './entities/role.entity.js';
import { Session } from './entities/session.entity.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { SessionsService } from './sessions.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, Permission, UserRole, Session]),
  ],
  controllers: [AuthController, UsersController, AccessController],
  providers: [UsersService, SessionsService, AuthService, AccessService],
  exports: [TypeOrmModule, UsersService, SessionsService, AuthService],
})
export class IdentityModule {}

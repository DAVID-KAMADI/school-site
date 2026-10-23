import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UserStatus } from './entities/user.entity.js';
import { MIN_PASSWORD_LENGTH } from './users.service.js';

export class LoginDto {
  @IsEmail()
  @MaxLength(191)
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

export class CodeDto {
  @Matches(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code.' })
  code: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  newPassword: string;
}

export class CreateUserDto {
  @IsEmail()
  @MaxLength(191)
  email: string;

  @IsString()
  @Length(2, 150)
  fullName: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'Enter a valid phone number.' })
  phone?: string;

  /** If omitted, a strong temporary password is generated and returned once. */
  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  fullName?: string;

  @IsOptional()
  @Matches(/^\+?[0-9 ]{7,20}$/, { message: 'Enter a valid phone number.' })
  phone?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class RoleGrantDto {
  @IsString()
  @MaxLength(50)
  roleKey: string;

  @IsOptional()
  @IsInt()
  scopePageId?: number | null;
}

export class SetRolesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  roles: RoleGrantDto[];
}

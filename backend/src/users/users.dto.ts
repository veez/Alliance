import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SystemRole, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UserListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: SystemRole }) @IsOptional() @IsEnum(SystemRole) systemRole?: SystemRole;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
}

export class InviteUserDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Некорректный email' })
  email: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  @ApiPropertyOptional({ enum: SystemRole, default: SystemRole.USER })
  @IsOptional()
  @IsEnum(SystemRole)
  systemRole?: SystemRole;

  @ApiPropertyOptional({ description: 'Организация пользователя (для членов, кандидатов, партнёров)' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional({ enum: SystemRole }) @IsOptional() @IsEnum(SystemRole) systemRole?: SystemRole;
  @ApiPropertyOptional({ description: 'Особые права «видеть всё»' }) @IsOptional() @IsBoolean() canViewAll?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  organizationId?: string | null;

  @ApiPropertyOptional({ enum: [UserStatus.ACTIVE, UserStatus.BLOCKED] })
  @IsOptional()
  @IsIn([UserStatus.ACTIVE, UserStatus.BLOCKED])
  status?: UserStatus;
}

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) position?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
}

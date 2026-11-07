import { ContactPrivacyDto } from '../common/privacy';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { OrganizationKind, OrganizationStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class OrganizationListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: OrganizationStatus }) @IsOptional() @IsEnum(OrganizationStatus) status?: OrganizationStatus;
  @ApiPropertyOptional({ enum: OrganizationKind }) @IsOptional() @IsEnum(OrganizationKind) kind?: OrganizationKind;
  @ApiPropertyOptional() @IsOptional() @IsString() regionCode?: string;
}

/** Поля профиля, которые может редактировать сама организация. */
export class OrganizationProfileDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(150) shortName?: string | null;
  @ApiProperty({ example: 'RU-MOW' }) @IsString() regionCode: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(150) city?: string | null;

  @ApiPropertyOptional({ description: 'ИНН (10 или 12 цифр)' })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^(\d{10}|\d{12})$/, { message: 'ИНН — 10 или 12 цифр' })
  inn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^(\d{13}|\d{15})$/, { message: 'ОГРН — 13 или 15 цифр' })
  ogrn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @Matches(/^\d{9}$/, { message: 'КПП — 9 цифр' })
  kpp?: string | null;

  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(500) legalAddress?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(500) postalAddress?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) activityAreas?: string[];
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(5000) description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsUrl({ require_protocol: true }, { message: 'Сайт — полный адрес, начиная с https://' })
  website?: string | null;

  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsEmail({}, { message: 'Некорректный email' }) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(50) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(200) headName?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(200) headPosition?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsLatitude() lat?: number | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsLongitude() lng?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showOnMap?: boolean;
  @ApiPropertyOptional({ type: ContactPrivacyDto }) @IsOptional() @ValidateNested() @Type(() => ContactPrivacyDto) contactPrivacy?: ContactPrivacyDto;
}

export class UpdateOrganizationDto extends PartialType(OrganizationProfileDto) {}

export class CreateOrganizationDto extends OrganizationProfileDto {
  @ApiPropertyOptional({ enum: OrganizationKind, default: OrganizationKind.ORGANIZATION })
  @IsOptional()
  @IsEnum(OrganizationKind)
  kind?: OrganizationKind;

  @ApiPropertyOptional({ enum: OrganizationStatus, default: OrganizationStatus.CANDIDATE })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: OrganizationStatus }) @IsEnum(OrganizationStatus) status: OrganizationStatus;
  @ApiPropertyOptional({ description: 'Основание: решение общего собрания, № протокола и т. п.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ description: 'Голосование, по итогам которого меняется статус' })
  @IsOptional()
  @IsUUID()
  voteId?: string;
}

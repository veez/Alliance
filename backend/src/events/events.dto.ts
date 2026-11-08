import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EventAudience, EventFormat, EventStatus, EventType, PresenceStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class EventDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) title: string;
  @ApiPropertyOptional({ description: 'Описание и повестка' }) @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(20000) description?: string | null;
  @ApiProperty({ enum: EventType }) @IsEnum(EventType) type: EventType;
  @ApiProperty({ enum: EventFormat }) @IsEnum(EventFormat) format: EventFormat;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(500) location?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf(notNull)
  @IsUrl({ require_protocol: true }, { message: 'Ссылка на трансляцию — полный адрес, начиная с https://' })
  onlineUrl?: string | null;

  @ApiProperty() @IsDateString() startsAt: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional({ description: 'Регистрация до (по умолчанию — до начала)' }) @IsOptional() @ValidateIf(notNull) @IsDateString() registrationDeadline?: string | null;
  @ApiPropertyOptional({ description: 'Для заседаний рабочей группы' }) @IsOptional() @ValidateIf(notNull) @IsUUID() workingGroupId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() visibleToPartners?: boolean;
  @ApiPropertyOptional({ enum: EventAudience, description: 'Кому рассылаются приглашения' }) @IsOptional() @IsEnum(EventAudience) audience?: EventAudience;
}

export class CreateEventDto extends EventDto {
  @ApiPropertyOptional({ description: 'Разослать приглашения участникам', default: true }) @IsOptional() @IsBoolean() notify?: boolean;
}

export class UpdateEventDto extends PartialType(EventDto) {}

export class EventListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['upcoming', 'past', 'all'] }) @IsOptional() @IsIn(['upcoming', 'past', 'all']) scope?: 'upcoming' | 'past' | 'all';
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: EventType }) @IsOptional() @IsEnum(EventType) type?: EventType;
  @ApiPropertyOptional({ enum: EventStatus }) @IsOptional() @IsEnum(EventStatus) status?: EventStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workingGroupId?: string;
}

export class RegistrationDto {
  @ApiProperty({ enum: ['CONFIRMED_OFFLINE', 'CONFIRMED_ONLINE', 'DECLINED'] })
  @IsIn(['CONFIRMED_OFFLINE', 'CONFIRMED_ONLINE', 'DECLINED'])
  registration: 'CONFIRMED_OFFLINE' | 'CONFIRMED_ONLINE' | 'DECLINED';
}

export class PresenceItemDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ enum: PresenceStatus }) @IsEnum(PresenceStatus) presence: PresenceStatus;
}

export class AttendanceDto {
  @ApiProperty({ type: [PresenceItemDto] })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => PresenceItemDto)
  items: PresenceItemDto[];
}

export class StatsQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventType, ProtocolStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { PageQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class ProtocolItemDto {
  @ApiProperty({ description: 'Вопрос повестки' }) @Transform(trim) @IsString() @MinLength(2) @MaxLength(2000) agendaText: string;
  @ApiPropertyOptional({ description: 'Слушали / обсуждение' }) @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(20000) discussion?: string | null;
  @ApiPropertyOptional({ description: 'Решили' }) @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(20000) decision?: string | null;
  @ApiPropertyOptional({ description: 'Связанное голосование' }) @IsOptional() @ValidateIf(notNull) @IsUUID() voteId?: string | null;
}

export class ProtocolDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) title: string;
  @ApiPropertyOptional({ example: '5-ОС/2026' }) @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(50) number?: string | null;
  @ApiProperty() @IsDateString() heldAt: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsUUID() eventId?: string | null;
  @ApiPropertyOptional({ description: 'Протокол рабочей группы без привязки к мероприятию' }) @IsOptional() @ValidateIf(notNull) @IsUUID() workingGroupId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() visibleToPartners?: boolean;

  @ApiProperty({ type: [ProtocolItemDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProtocolItemDto)
  items: ProtocolItemDto[];
}

export class ProtocolListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @ApiPropertyOptional({ enum: ProtocolStatus }) @IsOptional() @IsEnum(ProtocolStatus) status?: ProtocolStatus;
  @ApiPropertyOptional({ enum: EventType }) @IsOptional() @IsEnum(EventType) eventType?: EventType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workingGroupId?: string;
  @ApiPropertyOptional({ description: 'Только общие (без рабочих групп)' }) @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() generalOnly?: boolean;
}

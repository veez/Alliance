import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AgreementStatus, DuesStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { PageQuery } from '../common/pagination';

const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class DuesSettingsDto {
  @ApiProperty({ example: 36000 }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) amount: number;
  @ApiProperty({ example: '2026-12-01' }) @IsDateString() dueDate: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(365) graceDays?: number;
  @ApiPropertyOptional({ description: 'Голосуют только организации с оплаченным взносом за этот год' }) @IsOptional() @IsBoolean() votingRequiresPaid?: boolean;
  @ApiPropertyOptional({ description: 'Применить сумму и срок к уже начисленным (кроме освобождённых)' }) @IsOptional() @IsBoolean() applyToExisting?: boolean;
}

export class DuesRegistryQuery extends PageQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @ApiPropertyOptional({ enum: [...Object.values(DuesStatus), 'DEBT'] }) @IsOptional() @IsIn([...Object.values(DuesStatus), 'DEBT']) status?: DuesStatus | 'DEBT';
  @ApiPropertyOptional() @IsOptional() @IsString() regionCode?: string;
}

export class UpdateDuesDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100_000_000) amountDue?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsString() @MaxLength(2000) note?: string | null;
  @ApiPropertyOptional({ description: 'Освободить от взноса за год' }) @IsOptional() @IsBoolean() waived?: boolean;
}

export class PaymentDto {
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100_000_000) amount: number;
  @ApiProperty({ example: '2026-03-15' }) @IsDateString() paidAt: string;
  @ApiPropertyOptional({ description: 'Номер платёжного поручения' }) @IsOptional() @IsString() @MaxLength(100) documentNumber?: string;
}

export const DOC_TYPES = ['PAYMENT_ORDER', 'ACT', 'AGREEMENT', 'OTHER'] as const;
export class DocUploadDto {
  @ApiPropertyOptional({ enum: DOC_TYPES }) @IsOptional() @IsIn(DOC_TYPES) docType?: (typeof DOC_TYPES)[number];
}

export class AgreementDto {
  @ApiProperty() @IsUUID() organizationId: string;
  @ApiProperty({ example: 'ДП-2026/01' }) @IsString() @MaxLength(100) number: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsDateString() signedAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount?: number | null;
  @ApiPropertyOptional({ enum: AgreementStatus }) @IsOptional() @IsEnum(AgreementStatus) status?: AgreementStatus;
}

export class UpdateAgreementDto extends PartialType(AgreementDto) {}

export class AgreementListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ enum: AgreementStatus }) @IsOptional() @IsEnum(AgreementStatus) status?: AgreementStatus;
}

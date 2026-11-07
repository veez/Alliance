import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionFormat, VoteEligibility, VoteScenario, VoteStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class QuestionDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) text: string;
  @ApiProperty({ enum: QuestionFormat }) @IsEnum(QuestionFormat) format: QuestionFormat;

  @ApiPropertyOptional({ type: [String], description: 'Варианты (для YES_NO_ABSTAIN создаются автоматически)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  options?: string[];

  @ApiPropertyOptional({ description: 'MULTIPLE: минимум выбранных' }) @IsOptional() @IsInt() @Min(1) @Max(50) minChoices?: number;
  @ApiPropertyOptional({ description: 'MULTIPLE: максимум выбранных' }) @IsOptional() @IsInt() @Min(1) @Max(50) maxChoices?: number;
}

export class VoteDraftDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000) description?: string;
  @ApiProperty({ enum: VoteScenario }) @IsEnum(VoteScenario) scenario: VoteScenario;

  @ApiPropertyOptional({ description: 'ADMISSION: организация-кандидат' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  subjectOrganizationId?: string | null;

  @ApiPropertyOptional({ description: 'Начало (по умолчанию — момент публикации)' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsDateString()
  startsAt?: string | null;

  @ApiProperty() @IsDateString() endsAt: string;
  @ApiPropertyOptional({ description: 'Кворум, %. По умолчанию — из настроек' }) @IsOptional() @IsInt() @Min(0) @Max(100) quorumPercent?: number;
  @ApiProperty({ enum: VoteEligibility }) @IsEnum(VoteEligibility) eligibility: VoteEligibility;

  @ApiPropertyOptional({ type: [String], description: 'LIST: организации-участники' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  organizationIds?: string[];

  @ApiPropertyOptional({ type: [Number], description: 'Напоминания не проголосовавшим: за сколько часов до окончания' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(720, { each: true })
  reminderHours?: number[];

  @ApiProperty({ type: [QuestionDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Добавьте хотя бы один вопрос' })
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];
}

export class VoteListQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['active', 'archive', 'drafts'] }) @IsOptional() @IsIn(['active', 'archive', 'drafts']) tab?: 'active' | 'archive' | 'drafts';
  @ApiPropertyOptional({ enum: VoteStatus }) @IsOptional() @IsEnum(VoteStatus) status?: VoteStatus;
  @ApiPropertyOptional({ enum: VoteScenario }) @IsOptional() @IsEnum(VoteScenario) scenario?: VoteScenario;
  @ApiPropertyOptional() @IsOptional() @IsUUID() createdById?: string;
  @ApiPropertyOptional({ description: 'Окончание голосования — с' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Окончание голосования — по' }) @IsOptional() @IsDateString() to?: string;
}

export class BallotAnswerDto {
  @ApiProperty() @IsUUID() questionId: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) optionIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'RANKING: варианты от лучшего к худшему' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  ranking?: string[];
}

export class CastBallotDto {
  @ApiProperty({ type: [BallotAnswerDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BallotAnswerDto)
  answers: BallotAnswerDto[];
}

export class ExtendVoteDto {
  @ApiProperty() @IsDateString() endsAt: string;
}

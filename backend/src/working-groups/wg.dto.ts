import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CommentEntityType, PlanStatus, TaskStatus, WgRole, WorkingGroupStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class WorkingGroupDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(5000) goals?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(10000) description?: string | null;
  @ApiPropertyOptional({ description: 'Руководитель при создании' }) @IsOptional() @IsUUID() leadUserId?: string;
}

export class UpdateWorkingGroupDto extends PartialType(WorkingGroupDto) {
  @ApiPropertyOptional({ enum: WorkingGroupStatus }) @IsOptional() @IsEnum(WorkingGroupStatus) status?: WorkingGroupStatus;
}

export class MemberDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiPropertyOptional({ enum: WgRole }) @IsOptional() @IsEnum(WgRole) role?: WgRole;
}

export class MemberRoleDto {
  @ApiProperty({ enum: WgRole }) @IsEnum(WgRole) role: WgRole;
}

export class PlanItemDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(5000) description?: string | null;
  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @ValidateIf(notNull) @IsISO8601({ strict: true }) startDate?: string | null;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @ValidateIf(notNull) @IsISO8601({ strict: true }) dueDate?: string | null;
  @ApiPropertyOptional({ enum: PlanStatus }) @IsOptional() @IsEnum(PlanStatus) status?: PlanStatus;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsUUID() responsibleUserId?: string | null;
}

export class UpdatePlanItemDto extends PartialType(PlanItemDto) {}

export class TaskDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(300) title: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(10000) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsUUID() planItemId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf(notNull) @IsUUID() assigneeId?: string | null;
  @ApiPropertyOptional({ example: '2026-12-01' }) @IsOptional() @ValidateIf(notNull) @IsISO8601({ strict: true }) dueDate?: string | null;
  @ApiPropertyOptional({ enum: TaskStatus }) @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
}

export class UpdateTaskDto extends PartialType(TaskDto) {}

export class TaskListQuery {
  @ApiPropertyOptional({ enum: TaskStatus }) @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assigneeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() planItemId?: string;
  @ApiPropertyOptional({ description: 'Только мои' }) @IsOptional() @Transform(toBool) @IsBoolean() mine?: boolean;
}

export class CommentDto {
  @ApiProperty({ enum: [CommentEntityType.TASK, CommentEntityType.PLAN_ITEM] }) @IsEnum(CommentEntityType) entityType: CommentEntityType;
  @ApiProperty() @IsUUID() entityId: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(5000) body: string;
}

export class CommentQuery {
  @ApiProperty({ enum: CommentEntityType }) @IsEnum(CommentEntityType) entityType: CommentEntityType;
  @ApiProperty() @IsUUID() entityId: string;
}

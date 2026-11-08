import { Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta } from '../common/decorators';
import { ContactPrivacyDto, privacyData } from '../common/privacy';
import { PrismaService } from '../prisma/prisma.service';

const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value);
const notNull = (_: unknown, v: unknown) => v !== null && v !== undefined;

export class ResponsibilityDto {
  @ApiProperty() @IsUUID() areaId: string;
  @ApiPropertyOptional({ description: 'Для области «рабочая группа» — конкретная группа' })
  @IsOptional()
  @ValidateIf(notNull)
  @IsUUID()
  workingGroupId?: string | null;
}

export class EmployeeDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) fullName: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(200) position?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsEmail({}, { message: 'Некорректный email' }) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(50) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(300) vk?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(100) telegram?: string | null;
  @ApiPropertyOptional({ description: 'BOARD, COORDINATOR, EXPERT' }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(['BOARD', 'COORDINATOR', 'EXPERT'], { each: true }) allianceTags?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToNull) @ValidateIf(notNull) @IsString() @MaxLength(2000) notes?: string | null;
  @ApiPropertyOptional({ description: 'Есть согласие на обработку персональных данных' }) @IsOptional() @IsBoolean() pdConsent?: boolean;
  @ApiPropertyOptional({ type: ContactPrivacyDto }) @IsOptional() @ValidateNested() @Type(() => ContactPrivacyDto) contactPrivacy?: ContactPrivacyDto;

  @ApiPropertyOptional({ type: [ResponsibilityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ResponsibilityDto)
  responsibilities?: ResponsibilityDto[];
}

export class UpdateEmployeeDto extends PartialType(EmployeeDto) {}

const INCLUDE = {
  responsibilities: {
    include: { area: { select: { id: true, code: true, name: true } }, workingGroup: { select: { id: true, name: true } } },
  },
  user: { select: { id: true, email: true, status: true } },
} as const;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string, viewer: AuthUser) {
    this.access.assert(this.access.canReadEmployees(viewer, orgId));
    return this.prisma.employee.findMany({ where: { organizationId: orgId }, include: INCLUDE, orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }] });
  }

  async create(orgId: string, dto: EmployeeDto, actor: AuthUser, meta: RequestMeta) {
    this.access.assert(this.access.canManageEmployees(actor, orgId));
    if (!(await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }))) throw new NotFoundException('Организация не найдена');
    const { responsibilities, contactPrivacy, pdConsent, ...rest } = dto;
    const data = { ...rest, contactPrivacy: privacyData(contactPrivacy), pdConsentAt: pdConsent ? new Date() : undefined };
    return this.prisma.$transaction(async (tx) => {
      if (rest.isPrimary) await tx.employee.updateMany({ where: { organizationId: orgId }, data: { isPrimary: false } });
      const e = await tx.employee.create({
        data: { ...data, organizationId: orgId, responsibilities: { create: this.dedupe(responsibilities) } },
        include: INCLUDE,
      });
      await this.audit.log({ actorUserId: actor.id, action: 'employee.created', entityType: 'Employee', entityId: e.id, after: e, meta }, tx);
      return e;
    });
  }

  async update(orgId: string, id: string, dto: UpdateEmployeeDto, actor: AuthUser, meta: RequestMeta) {
    this.access.assert(this.access.canManageEmployees(actor, orgId));
    const before = await this.findInOrg(orgId, id);
    const { responsibilities, contactPrivacy, pdConsent, ...rest } = dto;
    // Дату согласия не сдвигаем, если оно уже было отмечено
    const pdConsentAt = pdConsent === undefined ? undefined : pdConsent ? (before.pdConsentAt ?? new Date()) : null;
    const data = { ...rest, contactPrivacy: privacyData(contactPrivacy), pdConsentAt };
    return this.prisma.$transaction(async (tx) => {
      if (rest.isPrimary) await tx.employee.updateMany({ where: { organizationId: orgId, id: { not: id } }, data: { isPrimary: false } });
      if (responsibilities) {
        await tx.employeeResponsibility.deleteMany({ where: { employeeId: id } });
        await tx.employeeResponsibility.createMany({ data: this.dedupe(responsibilities).map((r) => ({ ...r, employeeId: id })) });
      }
      const after = await tx.employee.update({ where: { id }, data, include: INCLUDE });
      await this.audit.log({ actorUserId: actor.id, action: 'employee.updated', entityType: 'Employee', entityId: id, before, after, meta }, tx);
      return after;
    });
  }

  async remove(orgId: string, id: string, actor: AuthUser, meta: RequestMeta) {
    this.access.assert(this.access.canManageEmployees(actor, orgId));
    const before = await this.findInOrg(orgId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.delete({ where: { id } });
      await this.audit.log({ actorUserId: actor.id, action: 'employee.deleted', entityType: 'Employee', entityId: id, before, meta }, tx);
    });
  }

  private async findInOrg(orgId: string, id: string) {
    const e = await this.prisma.employee.findFirst({ where: { id, organizationId: orgId }, include: INCLUDE });
    if (!e) throw new NotFoundException('Сотрудник не найден');
    return e;
  }

  private dedupe(list: ResponsibilityDto[] = []) {
    const seen = new Set<string>();
    return list
      .map((r) => ({ areaId: r.areaId, workingGroupId: r.workingGroupId ?? null }))
      .filter((r) => {
        const k = `${r.areaId}:${r.workingGroupId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }
}

@ApiTags('Сотрудники организаций')
@ApiBearerAuth()
@Controller('organizations/:orgId/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentUser() user: AuthUser) {
    return this.employees.list(orgId, user);
  }

  @Post()
  create(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() dto: EmployeeDto, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.employees.create(orgId, dto, user, meta);
  }

  @Patch(':id')
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.employees.update(orgId, id, dto, user, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.employees.remove(orgId, id, user, meta);
  }
}

@ApiTags('Справочники')
@ApiBearerAuth()
@Controller()
export class ReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('regions')
  regions() {
    return this.prisma.region.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  @Get('responsibility-areas')
  areas() {
    return this.prisma.responsibilityArea.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Get('working-groups/brief')
  workingGroups(@CurrentUser() u: AuthUser) {
    const staff = u.systemRole === 'ADMIN' || u.systemRole === 'SECRETARY';
    return this.prisma.workingGroup.findMany({ where: { status: 'ACTIVE', ...(staff ? {} : { OR: [{ isBoard: false }, { members: { some: { userId: u.id } } }] }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }
}

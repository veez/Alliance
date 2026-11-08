/** Карта Альянса и справочник контактов сообщества (этап 6). */
import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { P } from '../access/permissions';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { Page, pageArgs, PageQuery } from '../common/pagination';
import { maskContacts, readPrivacy } from '../common/privacy';
import { PrismaService } from '../prisma/prisma.service';

const MAP_STATUSES: OrganizationStatus[] = [OrganizationStatus.MEMBER, OrganizationStatus.CANDIDATE, OrganizationStatus.PARTNER];

export class ContactsQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'RU-MOW' }) @IsOptional() @IsString() @MaxLength(20) regionCode?: string;
  @ApiPropertyOptional({ example: 'Центральный' }) @IsOptional() @IsString() @MaxLength(50) district?: string;
  @ApiPropertyOptional({ description: 'Код области ответственности сотрудника' }) @IsOptional() @IsString() @MaxLength(50) areaCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() workingGroupId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
}

@Injectable()
export class CommunityService {
  constructor(private readonly prisma: PrismaService) {}

  private seesAll(u: AuthUser) {
    return u.permissions.has(P.ORGS_READ_ALL);
  }
  /** Скрытые контакты видят своя организация и «видящие всё». */
  private mask<T extends { email?: string | null; phone?: string | null; vk?: string | null; telegram?: string | null }>(obj: T, privacy: unknown, orgId: string, u: AuthUser): T {
    return this.seesAll(u) || u.organizationId === orgId ? obj : maskContacts(obj, privacy);
  }

  // ───────────── Карта ─────────────

  async map() {
    const [regions, orgs] = await Promise.all([
      this.prisma.region.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.organization.groupBy({ by: ['regionCode', 'status'], where: { status: { in: MAP_STATUSES }, showOnMap: true, isDemo: false }, _count: true }),
    ]);
    const count = (code: string, s: OrganizationStatus) => orgs.find((o) => o.regionCode === code && o.status === s)?._count ?? 0;
    const rows = regions.map((r) => ({
      code: r.code,
      name: r.name,
      district: r.federalDistrict,
      members: count(r.code, OrganizationStatus.MEMBER),
      candidates: count(r.code, OrganizationStatus.CANDIDATE),
      partners: count(r.code, OrganizationStatus.PARTNER),
    }));
    const sum = (k: 'members' | 'candidates' | 'partners') => rows.reduce((a, r) => a + r[k], 0);
    return {
      regions: rows,
      totals: {
        members: sum('members'),
        candidates: sum('candidates'),
        partners: sum('partners'),
        regionsWithMembers: rows.filter((r) => r.members > 0).length,
        regionsTotal: rows.length,
      },
    };
  }

  async region(code: string, u: AuthUser) {
    const region = await this.prisma.region.findUnique({ where: { code } });
    if (!region) throw new NotFoundException('Регион не найден');
    const orgs = await this.prisma.organization.findMany({
      where: { regionCode: code, status: { in: MAP_STATUSES }, showOnMap: true, isDemo: false },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const contacts = u.permissions.has(P.CONTACTS_READ) || this.seesAll(u);
    return {
      region: { code: region.code, name: region.name, district: region.federalDistrict },
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        shortName: o.shortName,
        kind: o.kind,
        status: o.status,
        city: o.city,
        website: o.website,
        activityAreas: o.activityAreas,
        logoFileId: o.logoFileId,
        // Контакты на карте — только членам Альянса
        contacts: contacts ? this.mask({ headName: o.headName, headPosition: o.headPosition, email: o.email, phone: o.phone }, o.contactPrivacy, o.id, u) : null,
      })),
    };
  }

  // ───────────── Справочник ─────────────

  private orgWhere(q: ContactsQuery): Prisma.OrganizationWhereInput {
    return {
      status: OrganizationStatus.MEMBER,
      isDemo: false,
      regionCode: q.regionCode,
      region: q.district ? { federalDistrict: q.district } : undefined,
      id: q.organizationId,
    };
  }

  async organizations(q: ContactsQuery, u: AuthUser): Promise<Page<unknown>> {
    const where: Prisma.OrganizationWhereInput = {
      ...this.orgWhere(q),
      OR: q.search
        ? [
            { name: { contains: q.search, mode: 'insensitive' } },
            { shortName: { contains: q.search, mode: 'insensitive' } },
            { city: { contains: q.search, mode: 'insensitive' } },
            { headName: { contains: q.search, mode: 'insensitive' } },
            { activityAreas: { has: q.search.toLowerCase() } },
          ]
        : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({ where, include: { region: true }, orderBy: { name: 'asc' }, ...pageArgs(q) }),
      this.prisma.organization.count({ where }),
    ]);
    return {
      items: rows.map((o) => ({
        id: o.id,
        name: o.name,
        shortName: o.shortName,
        kind: o.kind,
        city: o.city,
        region: o.region ? { code: o.region.code, name: o.region.name, district: o.region.federalDistrict } : null,
        website: o.website,
        activityAreas: o.activityAreas,
        logoFileId: o.logoFileId,
        ...this.mask({ headName: o.headName, headPosition: o.headPosition, email: o.email, phone: o.phone }, o.contactPrivacy, o.id, u),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async people(q: ContactsQuery, u: AuthUser): Promise<Page<unknown>> {
    const and: Prisma.EmployeeWhereInput[] = [{ organization: this.orgWhere(q) }];
    if (q.areaCode || q.workingGroupId) {
      and.push({ responsibilities: { some: { area: q.areaCode ? { code: q.areaCode } : undefined, workingGroupId: q.workingGroupId } } });
    }
    if (q.search) {
      and.push({
        OR: [
          { fullName: { contains: q.search, mode: 'insensitive' } },
          { position: { contains: q.search, mode: 'insensitive' } },
          { organization: { name: { contains: q.search, mode: 'insensitive' } } },
          { organization: { shortName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    // Скрывшиеся из справочника видны только своей организации и «видящим всё»
    if (!this.seesAll(u)) {
      and.push({
        OR: [
          // У записей без этого ключа значение пути — NULL, и одного NOT здесь недостаточно
          { contactPrivacy: { path: ['hideFromDirectory'], equals: Prisma.AnyNull } },
          { contactPrivacy: { path: ['hideFromDirectory'], equals: false } },
          ...(u.organizationId ? [{ organizationId: u.organizationId }] : []),
        ],
      });
    }
    const where: Prisma.EmployeeWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true, shortName: true, city: true, region: { select: { code: true, name: true } } } },
          responsibilities: { include: { area: { select: { code: true, name: true } }, workingGroup: { select: { id: true, name: true } } } },
        },
        orderBy: [{ organization: { name: 'asc' } }, { isPrimary: 'desc' }, { fullName: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return {
      items: rows.map((e) => ({
        id: e.id,
        fullName: e.fullName,
        position: e.position,
        allianceTags: e.allianceTags,
        isPrimary: e.isPrimary,
        ...this.mask({ email: e.email, phone: e.phone, vk: e.vk, telegram: e.telegram }, e.contactPrivacy, e.organizationId, u),
        hiddenFromDirectory: !!readPrivacy(e.contactPrivacy).hideFromDirectory,
        organization: { id: e.organization.id, name: e.organization.shortName || e.organization.name, city: e.organization.city, region: e.organization.region },
        responsibilities: e.responsibilities.map((r) => ({ area: r.area, workingGroup: r.workingGroup })),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

@ApiTags('Карта и контакты')
@ApiBearerAuth()
@Controller()
export class CommunityController {
  constructor(private readonly community: CommunityService) {}

  @Get('map')
  @RequirePermissions(P.MAP_READ)
  @ApiOperation({ summary: 'Регионы и число организаций по слоям (члены, кандидаты, партнёры)' })
  map() {
    return this.community.map();
  }

  @Get('map/regions/:code')
  @RequirePermissions(P.MAP_READ)
  @ApiOperation({ summary: 'Организации региона; контакты — только членам Альянса' })
  region(@Param('code') code: string, @CurrentUser() u: AuthUser) {
    return this.community.region(code, u);
  }

  @Get('contacts/organizations')
  @RequirePermissions(P.CONTACTS_READ)
  organizations(@Query() q: ContactsQuery, @CurrentUser() u: AuthUser) {
    return this.community.organizations(q, u);
  }

  @Get('contacts/people')
  @RequirePermissions(P.CONTACTS_READ)
  people(@Query() q: ContactsQuery, @CurrentUser() u: AuthUser) {
    return this.community.people(q, u);
  }
}

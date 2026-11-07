import { maskContacts, privacyData } from '../common/privacy';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Organization, OrganizationStatus, Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Page, pageArgs } from '../common/pagination';
import { mskYear } from '../common/time';
import { DuesService } from '../dues/dues.service';
import { FilesService, UploadedFileLike } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeStatusDto, CreateOrganizationDto, OrganizationListQuery, UpdateOrganizationDto } from './organizations.dto';

/** Статусы, видимые обычным участникам в общем списке. */
const COMMUNITY_STATUSES: OrganizationStatus[] = ['MEMBER', 'CANDIDATE', 'PARTNER'];

const BASIC_FIELDS = ['id', 'kind', 'status', 'name', 'shortName', 'regionCode', 'city', 'activityAreas', 'description', 'website', 'logoFileId', 'joinedAt', 'showOnMap'] as const;
const CONTACT_FIELDS = ['email', 'phone', 'headName', 'headPosition'] as const;

type OrgWithRegion = Organization & { region?: { code: string; name: string } | null };

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly dues: DuesService,
  ) {}

  /**
   * Ограничивает поля карточки по правам: реквизиты — только своей организации и «видящим всё»,
   * контакты — членам Альянса (право contacts.read).
   */
  present(org: OrgWithRegion, viewer: AuthUser) {
    if (this.access.canReadOrganizationFull(viewer, org.id)) return { ...org, fullAccess: true };
    const out: Record<string, unknown> = { region: org.region, fullAccess: false };
    for (const f of BASIC_FIELDS) out[f] = org[f];
    if (viewer.permissions.has(P.CONTACTS_READ)) {
      for (const f of CONTACT_FIELDS) out[f] = org[f];
      Object.assign(out, maskContacts({ email: org.email, phone: org.phone }, org.contactPrivacy));
    }
    return out;
  }

  async list(q: OrganizationListQuery, viewer: AuthUser): Promise<Page<unknown>> {
    const full = viewer.permissions.has(P.ORGS_READ_ALL);
    const statusFilter: Prisma.EnumOrganizationStatusFilter | OrganizationStatus | undefined = full
      ? q.status
      : q.status && COMMUNITY_STATUSES.includes(q.status)
        ? q.status
        : { in: COMMUNITY_STATUSES };
    const where: Prisma.OrganizationWhereInput = {
      status: statusFilter,
      kind: q.kind,
      regionCode: q.regionCode,
      OR: q.search
        ? [
            { name: { contains: q.search, mode: 'insensitive' } },
            { shortName: { contains: q.search, mode: 'insensitive' } },
            { city: { contains: q.search, mode: 'insensitive' } },
            ...(full ? [{ inn: { contains: q.search } }] : []),
          ]
        : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: { region: { select: { code: true, name: true } } },
        orderBy: { name: 'asc' },
        ...pageArgs(q),
      }),
      this.prisma.organization.count({ where }),
    ]);
    return { items: rows.map((o) => this.present(o, viewer)), total, page: q.page, pageSize: q.pageSize };
  }

  private async findOrThrow(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id }, include: { region: { select: { code: true, name: true } } } });
    if (!org) throw new NotFoundException('Организация не найдена');
    return org;
  }

  async get(id: string, viewer: AuthUser) {
    const org = await this.findOrThrow(id);
    const full = this.access.canReadOrganizationFull(viewer, id);
    if (!full && !COMMUNITY_STATUSES.includes(org.status)) throw new NotFoundException('Организация не найдена');
    return this.present(org, viewer);
  }

  async create(dto: CreateOrganizationDto, actor: AuthUser, meta: RequestMeta) {
    await this.assertRegion(dto.regionCode);
    const status = dto.status ?? OrganizationStatus.CANDIDATE;
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { ...dto, contactPrivacy: privacyData(dto.contactPrivacy), status, joinedAt: status === OrganizationStatus.MEMBER ? new Date() : null },
        include: { region: { select: { code: true, name: true } } },
      });
      await tx.organizationStatusHistory.create({
        data: { organizationId: org.id, fromStatus: null, toStatus: status, reason: 'Создание карточки', changedById: actor.id },
      });
      await this.audit.log({ actorUserId: actor.id, action: 'organization.created', entityType: 'Organization', entityId: org.id, after: org, meta }, tx);
      return org;
    });
  }

  async update(id: string, dto: UpdateOrganizationDto, actor: AuthUser, meta: RequestMeta) {
    this.access.assert(this.access.canEditOrganization(actor, id));
    const before = await this.findOrThrow(id);
    if (dto.regionCode) await this.assertRegion(dto.regionCode);
    const after = await this.prisma.organization.update({
      where: { id },
      data: { ...dto, contactPrivacy: privacyData(dto.contactPrivacy) },
      include: { region: { select: { code: true, name: true } } },
    });
    await this.audit.log({ actorUserId: actor.id, action: 'organization.updated', entityType: 'Organization', entityId: id, before, after, meta });
    return after;
  }

  async changeStatus(id: string, dto: ChangeStatusDto, actor: AuthUser, meta: RequestMeta) {
    const before = await this.findOrThrow(id);
    if (before.status === dto.status) throw new BadRequestException('Организация уже в этом статусе');
    if (dto.voteId) {
      const vote = await this.prisma.vote.findUnique({ where: { id: dto.voteId }, select: { status: true, subjectOrganizationId: true } });
      if (!vote || vote.status !== 'CLOSED' || vote.subjectOrganizationId !== id) throw new BadRequestException('Голосование не завершено или относится к другой организации');
    }
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.organization.update({
        where: { id },
        data: {
          status: dto.status,
          joinedAt: dto.status === OrganizationStatus.MEMBER && !before.joinedAt ? new Date() : undefined,
        },
        include: { region: { select: { code: true, name: true } } },
      });
      await tx.organizationStatusHistory.create({
        data: { organizationId: id, fromStatus: before.status, toStatus: dto.status, reason: dto.reason, voteId: dto.voteId, changedById: actor.id },
      });
      if (dto.status === OrganizationStatus.MEMBER) {
        await tx.candidateApplication.updateMany({ where: { organizationId: id }, data: { status: 'APPROVED', decidedAt: new Date(), admissionVoteId: dto.voteId } });
        // Новому члену сразу начисляется взнос текущего года (если сумма за год задана)
        await this.dues.accrue(mskYear(), null, meta, id, tx);
      } else if (before.status === OrganizationStatus.CANDIDATE && dto.status === OrganizationStatus.EXITED) {
        await tx.candidateApplication.updateMany({ where: { organizationId: id }, data: { status: 'REJECTED', decidedAt: new Date(), admissionVoteId: dto.voteId } });
      }
      await this.audit.log(
        { actorUserId: actor.id, action: 'organization.status_changed', entityType: 'Organization', entityId: id, before: { status: before.status }, after: { status: dto.status, reason: dto.reason }, meta },
        tx,
      );
      return after;
    });
  }

  async statusHistory(id: string, viewer: AuthUser) {
    this.access.assert(this.access.canReadOrganizationFull(viewer, id));
    await this.findOrThrow(id);
    return this.prisma.organizationStatusHistory.findMany({
      where: { organizationId: id },
      orderBy: { changedAt: 'desc' },
      include: { changedBy: { select: { id: true, fullName: true } } },
    });
  }

  async uploadLogo(id: string, file: UploadedFileLike | undefined, actor: AuthUser, meta: RequestMeta) {
    this.access.assert(this.access.canEditOrganization(actor, id));
    if (!file) throw new BadRequestException('Файл не передан');
    await this.findOrThrow(id);
    // SVG не принимаем: может содержать скрипты
    const saved = await this.files.save(file, actor.id, { allowedMime: /^image\/(png|jpeg|webp)$/, maxBytes: 2 * 1024 * 1024 });
    await this.prisma.organization.update({ where: { id }, data: { logoFileId: saved.id } });
    await this.audit.log({ actorUserId: actor.id, action: 'organization.logo_updated', entityType: 'Organization', entityId: id, after: { logoFileId: saved.id }, meta });
    return { logoFileId: saved.id };
  }

  async openLogo(id: string) {
    const org = await this.findOrThrow(id);
    if (!org.logoFileId) throw new NotFoundException('Логотип не загружен');
    return this.files.open(org.logoFileId);
  }

  private async assertRegion(code: string) {
    if (!(await this.prisma.region.findUnique({ where: { code } }))) throw new BadRequestException('Неизвестный регион');
  }
}

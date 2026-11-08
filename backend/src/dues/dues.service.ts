import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DuesStatus, FileEntityType, OrganizationStatus, Prisma, UserStatus } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Page, pageArgs } from '../common/pagination';
import { mskYear } from '../common/time';
import { env } from '../config/env';
import { FilesService, UploadedFileLike } from '../files/files.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { computeDuesStatus, dateOnly, mskToday, reminderKind, toKop } from './dues-logic';
import { AgreementDto, AgreementListQuery, DuesRegistryQuery, DuesSettingsDto, PaymentDto, UpdateAgreementDto, UpdateDuesDto } from './dues.dto';

const DEBT_STATUSES: DuesStatus[] = [DuesStatus.UNPAID, DuesStatus.PARTIAL, DuesStatus.OVERDUE];
const rub = (kop: number) => kop / 100;
const fmtRub = (kop: number) => rub(kop).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (d: Date) => dateOnly(d).split('-').reverse().join('.');
const FILE_SELECT = { id: true, originalName: true, mime: true, size: true, createdAt: true, uploadedBy: { select: { id: true, fullName: true } } } as const;

type Tx = Prisma.TransactionClient;

@Injectable()
export class DuesService {
  private readonly logger = new Logger('Dues');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  // ───────────── Доступ ─────────────

  private canReadAll(u: AuthUser) {
    return u.permissions.has(P.DUES_READ_ALL) || u.permissions.has(P.DUES_MANAGE);
  }

  private assertReadOrg(u: AuthUser, organizationId: string) {
    const own = u.permissions.has(P.DUES_READ_OWN) && this.access.isOwnOrganization(u, organizationId);
    if (!this.canReadAll(u) && !own) throw new NotFoundException('Не найдено');
  }

  /**
   * Договоры пожертвования: все видят только секретарь и администратор.
   * Организация — только свои, в том числе если у её представителя особые права «видеть всё».
   */
  private canSeeAgreementsOf(u: AuthUser, organizationId: string) {
    return u.permissions.has(P.DUES_MANAGE) || (u.permissions.has(P.DUES_READ_OWN) && this.access.isOwnOrganization(u, organizationId));
  }

  private assertManage(u: AuthUser) {
    if (!u.permissions.has(P.DUES_MANAGE)) throw new ForbiddenException('Недостаточно прав');
  }

  // ───────────── Настройки года ─────────────

  listSettings() {
    return this.prisma.duesSettings.findMany({ orderBy: { year: 'desc' } });
  }

  async upsertSettings(year: number, dto: DuesSettingsDto, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const before = await this.prisma.duesSettings.findUnique({ where: { year } });
    const data = { amount: dto.amount, dueDate: new Date(dto.dueDate.slice(0, 10)), graceDays: dto.graceDays ?? 0, votingRequiresPaid: dto.votingRequiresPaid ?? false };
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.duesSettings.upsert({ where: { year }, create: { year, ...data }, update: data });
      let updated = 0;
      if (dto.applyToExisting) {
        const res = await tx.dues.updateMany({ where: { year, status: { not: DuesStatus.WAIVED } }, data: { amountDue: data.amount, dueDate: data.dueDate } });
        updated = res.count;
        const ids = await tx.dues.findMany({ where: { year }, select: { id: true } });
        for (const { id } of ids) await this.recompute(id, tx);
      }
      await this.audit.log({ actorUserId: actor.id, action: 'dues.settings_saved', entityType: 'DuesSettings', entityId: String(year), before, after: { ...s, appliedToExisting: updated }, meta }, tx);
      return { ...s, appliedToExisting: updated };
    });
  }

  /** Начислить взнос за год всем членам Альянса, у которых его ещё нет. */
  async accrue(year: number, actor: AuthUser | null, meta?: RequestMeta, onlyOrganizationId?: string, tx: Tx = this.prisma) {
    if (actor) this.assertManage(actor);
    const s = await tx.duesSettings.findUnique({ where: { year } });
    if (!s) {
      if (onlyOrganizationId) return 0;
      throw new BadRequestException(`Сначала задайте сумму и срок взноса за ${year} год`);
    }
    const orgs = await tx.organization.findMany({
      where: { status: OrganizationStatus.MEMBER, isDemo: false, dues: { none: { year } }, ...(onlyOrganizationId ? { id: onlyOrganizationId } : {}) },
      select: { id: true },
    });
    if (!orgs.length) return 0;
    await tx.dues.createMany({ data: orgs.map((o) => ({ organizationId: o.id, year, amountDue: s.amount, dueDate: s.dueDate })), skipDuplicates: true });
    const created = await tx.dues.findMany({ where: { year, organizationId: { in: orgs.map((o) => o.id) } }, select: { id: true } });
    for (const { id } of created) await this.recompute(id, tx);
    await this.audit.log({ actorUserId: actor?.id ?? null, action: 'dues.accrued', entityType: 'DuesSettings', entityId: String(year), after: { organizations: orgs.length }, meta }, tx);
    return orgs.length;
  }

  /** Пересчитать статус по сумме оплат и сроку. */
  async recompute(duesId: string, tx: Tx = this.prisma, now = new Date()) {
    const d = await tx.dues.findUniqueOrThrow({ where: { id: duesId }, include: { settings: { select: { graceDays: true } } } });
    const agg = await tx.duesPayment.aggregate({ where: { duesId }, _sum: { amount: true } });
    const status = computeDuesStatus({
      amountDue: d.amountDue,
      paidTotal: agg._sum.amount ?? 0,
      dueDate: d.dueDate,
      graceDays: d.settings.graceDays,
      current: d.status,
      now,
    });
    if (status !== d.status) await tx.dues.update({ where: { id: duesId }, data: { status } });
    return status;
  }

  /** Ежедневно: незакрытые взносы становятся просроченными по сроку. */
  async recomputeOpen(now = new Date()) {
    const open = await this.prisma.dues.findMany({ where: { status: { in: [DuesStatus.UNPAID, DuesStatus.PARTIAL] } }, select: { id: true } });
    let changed = 0;
    for (const { id } of open) {
      const before = (await this.prisma.dues.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
      if ((await this.recompute(id, this.prisma, now)) !== before) changed++;
    }
    return changed;
  }

  // ───────────── Реестр ─────────────

  private async withTotals<T extends { id: string; amountDue: Prisma.Decimal }>(rows: T[]) {
    const ids = rows.map((r) => r.id);
    const [sums, docs] = await Promise.all([
      this.prisma.duesPayment.groupBy({ by: ['duesId'], where: { duesId: { in: ids } }, _sum: { amount: true }, _max: { paidAt: true } }),
      this.prisma.fileLink.groupBy({ by: ['entityId'], where: { entityType: FileEntityType.DUES, entityId: { in: ids } }, _count: true }),
    ]);
    const sumBy = new Map(sums.map((s) => [s.duesId, s]));
    const docsBy = new Map(docs.map((d) => [d.entityId, d._count]));
    return rows.map((r) => {
      const s = sumBy.get(r.id);
      const paidKop = toKop(s?._sum.amount ?? 0);
      const dueKop = toKop(r.amountDue);
      return { ...r, amountDue: rub(dueKop), paid: rub(paidKop), debt: rub(Math.max(0, dueKop - paidKop)), lastPaidAt: s?._max.paidAt ?? null, documentsCount: docsBy.get(r.id) ?? 0 };
    });
  }

  async registry(q: DuesRegistryQuery, user: AuthUser): Promise<Page<unknown> & { summary: unknown; settings: unknown }> {
    if (!this.canReadAll(user)) throw new ForbiddenException('Недостаточно прав');
    const where: Prisma.DuesWhereInput = {
      year: q.year,
      status: q.status === 'DEBT' ? { in: DEBT_STATUSES } : q.status,
      organization: {
        isDemo: false,
        regionCode: q.regionCode,
        OR: q.search ? [{ name: { contains: q.search, mode: 'insensitive' } }, { shortName: { contains: q.search, mode: 'insensitive' } }, { inn: { contains: q.search } }] : undefined,
      },
    };
    const [rows, total, summary, settings] = await Promise.all([
      this.prisma.dues.findMany({
        where,
        include: { organization: { select: { id: true, name: true, shortName: true, status: true, region: { select: { name: true } } } } },
        orderBy: [{ organization: { name: 'asc' } }],
        ...pageArgs(q),
      }),
      this.prisma.dues.count({ where }),
      this.summary(q.year, user),
      this.prisma.duesSettings.findUnique({ where: { year: q.year } }),
    ]);
    return { items: await this.withTotals(rows), total, page: q.page, pageSize: q.pageSize, summary, settings };
  }

  async summary(year: number, user: AuthUser) {
    if (!this.canReadAll(user)) throw new ForbiddenException('Недостаточно прав');
    const [byStatus, due, paid, members, settings] = await Promise.all([
      this.prisma.dues.groupBy({ by: ['status'], where: { year, organization: { isDemo: false } }, _count: true }),
      this.prisma.dues.aggregate({ where: { year, organization: { isDemo: false }, status: { not: DuesStatus.WAIVED } }, _sum: { amountDue: true } }),
      this.prisma.duesPayment.aggregate({ where: { dues: { year, organization: { isDemo: false } } }, _sum: { amount: true } }),
      this.prisma.organization.count({ where: { status: OrganizationStatus.MEMBER, isDemo: false } }),
      this.prisma.duesSettings.findUnique({ where: { year } }),
    ]);
    const counts = Object.fromEntries(Object.values(DuesStatus).map((s) => [s, 0])) as Record<DuesStatus, number>;
    for (const r of byStatus) counts[r.status] = r._count;
    const accrued = Object.values(counts).reduce((a, b) => a + b, 0);
    const dueKop = toKop(due._sum.amountDue ?? 0);
    const paidKop = toKop(paid._sum.amount ?? 0);
    return {
      year,
      settings,
      counts,
      accrued,
      notAccrued: Math.max(0, members - (await this.prisma.dues.count({ where: { year, organization: { status: OrganizationStatus.MEMBER, isDemo: false } } }))),
      totalDue: rub(dueKop),
      totalPaid: rub(paidKop),
      totalDebt: rub(Math.max(0, dueKop - paidKop)),
    };
  }

  // ───────────── Карточка взноса и история организации ─────────────

  private async load(id: string) {
    const d = await this.prisma.dues.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, shortName: true, status: true } },
        settings: true,
        payments: { orderBy: { paidAt: 'asc' }, include: { recordedBy: { select: { id: true, fullName: true } } } },
      },
    });
    if (!d) throw new NotFoundException('Взнос не найден');
    return d;
  }

  private filesOf(entityType: FileEntityType, entityIds: string[]) {
    return this.prisma.fileLink.findMany({
      where: { entityType, entityId: { in: entityIds } },
      include: { file: { select: FILE_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async present(d: Awaited<ReturnType<DuesService['load']>>) {
    const [withTotals] = await this.withTotals([d]);
    const files = await this.filesOf(FileEntityType.DUES, [d.id]);
    return {
      ...withTotals,
      payments: d.payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      documents: files.map((f) => ({ ...f.file, docType: f.docType })),
    };
  }

  async get(id: string, user: AuthUser) {
    const d = await this.load(id);
    this.assertReadOrg(user, d.organizationId);
    return this.present(d);
  }

  async orgHistory(orgId: string, user: AuthUser) {
    this.assertReadOrg(user, orgId);
    const rows = await this.prisma.dues.findMany({
      where: { organizationId: orgId },
      orderBy: { year: 'desc' },
      include: {
        organization: { select: { id: true, name: true, shortName: true, status: true } },
        settings: true,
        payments: { orderBy: { paidAt: 'asc' }, include: { recordedBy: { select: { id: true, fullName: true } } } },
      },
    });
    const dues = await Promise.all(rows.map((r) => this.present(r)));
    const agreementsVisible = this.canSeeAgreementsOf(user, orgId);
    const agreements = agreementsVisible ? await this.prisma.donationAgreement.findMany({ where: { organizationId: orgId }, orderBy: [{ year: 'desc' }, { number: 'asc' }] }) : [];
    const agreementFiles = await this.filesOf(FileEntityType.AGREEMENT, agreements.map((a) => a.id));
    return {
      dues,
      agreementsVisible,
      agreements: agreements.map((a) => ({
        ...a,
        amount: a.amount === null ? null : Number(a.amount),
        documents: agreementFiles.filter((f) => f.entityId === a.id).map((f) => ({ ...f.file, docType: f.docType })),
      })),
    };
  }

  /** Статус взноса текущего года своей организации (для дашборда). */
  async my(user: AuthUser) {
    if (!user.organizationId || !user.permissions.has(P.DUES_READ_OWN)) return null;
    const year = mskYear();
    const [d, older] = await Promise.all([
      this.prisma.dues.findUnique({ where: { organizationId_year: { organizationId: user.organizationId, year } }, include: { settings: true } }),
      this.prisma.dues.findMany({ where: { organizationId: user.organizationId, year: { lt: year }, status: { in: DEBT_STATUSES } } }),
    ]);
    const previousDebt = (await this.withTotals(older)).reduce((s, r) => s + r.debt, 0);
    if (!d) return { year, dues: null, previousDebt };
    const [t] = await this.withTotals([d]);
    return { year, dues: t, previousDebt };
  }

  // ───────────── Изменения ─────────────

  async update(id: string, dto: UpdateDuesDto, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const before = await this.load(id);
    return this.prisma.$transaction(async (tx) => {
      let status: DuesStatus | undefined;
      if (dto.waived === true) status = DuesStatus.WAIVED;
      if (dto.waived === false && before.status === DuesStatus.WAIVED) status = DuesStatus.UNPAID; // пересчитается ниже
      await tx.dues.update({
        where: { id },
        data: { amountDue: dto.amountDue, dueDate: dto.dueDate ? new Date(dto.dueDate.slice(0, 10)) : undefined, note: dto.note, status },
      });
      await this.recompute(id, tx);
      const after = await tx.dues.findUniqueOrThrow({ where: { id } });
      await this.audit.log({ actorUserId: actor.id, action: 'dues.updated', entityType: 'Dues', entityId: id, before: { amountDue: before.amountDue, dueDate: before.dueDate, status: before.status, note: before.note }, after, meta }, tx);
      return after;
    });
  }

  async addPayment(id: string, dto: PaymentDto, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const d = await this.load(id);
    if (new Date(dto.paidAt) > new Date(Date.now() + 86_400_000)) throw new BadRequestException('Дата платежа в будущем');
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.duesPayment.create({
        data: { duesId: id, amount: dto.amount, paidAt: new Date(dto.paidAt.slice(0, 10)), documentNumber: dto.documentNumber, recordedById: actor.id },
      });
      const status = await this.recompute(id, tx);
      await this.audit.log({ actorUserId: actor.id, action: 'dues.payment_added', entityType: 'Dues', entityId: id, after: { payment: p, status, organizationId: d.organizationId, year: d.year }, meta }, tx);
      return { payment: { ...p, amount: Number(p.amount) }, status };
    });
  }

  async removePayment(id: string, paymentId: string, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const p = await this.prisma.duesPayment.findFirst({ where: { id: paymentId, duesId: id } });
    if (!p) throw new NotFoundException('Платёж не найден');
    await this.prisma.$transaction(async (tx) => {
      await tx.duesPayment.delete({ where: { id: paymentId } });
      const status = await this.recompute(id, tx);
      await this.audit.log({ actorUserId: actor.id, action: 'dues.payment_removed', entityType: 'Dues', entityId: id, before: { payment: p }, after: { status }, meta }, tx);
    });
  }

  // ───────────── Документы ─────────────

  /** Документы к взносу: секретарь/админ — любые, организация — к своему взносу (платёжки). */
  async addDuesDocument(id: string, file: UploadedFileLike | undefined, docType: string | undefined, actor: AuthUser, meta: RequestMeta) {
    const d = await this.load(id);
    const own = this.access.isOwnOrganization(actor, d.organizationId) && actor.permissions.has(P.DUES_READ_OWN);
    if (!actor.permissions.has(P.DUES_MANAGE) && !own) throw new ForbiddenException('Недостаточно прав');
    return this.attach(FileEntityType.DUES, id, file, docType ?? 'PAYMENT_ORDER', actor, meta, 'Dues');
  }

  async openDuesDocument(id: string, fileId: string, user: AuthUser) {
    const d = await this.load(id);
    this.assertReadOrg(user, d.organizationId);
    return this.openLinked(FileEntityType.DUES, id, fileId);
  }

  async removeDuesDocument(id: string, fileId: string, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    return this.detach(FileEntityType.DUES, id, fileId, actor, meta, 'Dues');
  }

  private async attach(entityType: FileEntityType, entityId: string, file: UploadedFileLike | undefined, docType: string, actor: AuthUser, meta: RequestMeta, auditType: string) {
    if (!file) throw new BadRequestException('Файл не передан');
    const saved = await this.files.save(file, actor.id, {
      maxBytes: 20 * 1024 * 1024,
      allowedMime: /^(application\/pdf|image\/(png|jpeg|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.oasis\.opendocument\.[\w.]+|zip)|text\/plain)$/,
    });
    await this.prisma.fileLink.create({ data: { fileId: saved.id, entityType, entityId, docType } });
    await this.audit.log({ actorUserId: actor.id, action: `${auditType.toLowerCase()}.document_added`, entityType: auditType, entityId, after: { fileId: saved.id, name: saved.originalName, docType, sha256: saved.sha256 }, meta });
    return { id: saved.id, originalName: saved.originalName, mime: saved.mime, size: saved.size, docType, createdAt: saved.createdAt };
  }

  private async openLinked(entityType: FileEntityType, entityId: string, fileId: string) {
    const link = await this.prisma.fileLink.findFirst({ where: { entityType, entityId, fileId } });
    if (!link) throw new NotFoundException('Файл не найден');
    return this.files.open(fileId);
  }

  private async detach(entityType: FileEntityType, entityId: string, fileId: string, actor: AuthUser, meta: RequestMeta, auditType: string) {
    const res = await this.prisma.fileLink.deleteMany({ where: { entityType, entityId, fileId } });
    if (!res.count) throw new NotFoundException('Файл не найден');
    await this.audit.log({ actorUserId: actor.id, action: `${auditType.toLowerCase()}.document_removed`, entityType: auditType, entityId, before: { fileId }, meta });
  }

  // ───────────── Договоры пожертвования ─────────────

  async listAgreements(q: AgreementListQuery, user: AuthUser): Promise<Page<unknown>> {
    const manage = user.permissions.has(P.DUES_MANAGE);
    if (!manage && !(user.permissions.has(P.DUES_READ_OWN) && user.organizationId)) throw new ForbiddenException('Недостаточно прав');
    const where: Prisma.DonationAgreementWhereInput = {
      year: q.year,
      organizationId: manage ? q.organizationId : user.organizationId!,
      status: q.status,
      OR: q.search
        ? [{ number: { contains: q.search, mode: 'insensitive' } }, { organization: { name: { contains: q.search, mode: 'insensitive' } } }]
        : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.donationAgreement.findMany({
        where,
        include: { organization: { select: { id: true, name: true, shortName: true } } },
        orderBy: [{ year: 'desc' }, { signedAt: 'desc' }, { number: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.donationAgreement.count({ where }),
    ]);
    const files = await this.filesOf(FileEntityType.AGREEMENT, rows.map((r) => r.id));
    return {
      items: rows.map((a) => ({
        ...a,
        amount: a.amount === null ? null : Number(a.amount),
        documents: files.filter((f) => f.entityId === a.id).map((f) => ({ ...f.file, docType: f.docType })),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async createAgreement(dto: AgreementDto, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    if (!(await this.prisma.organization.findUnique({ where: { id: dto.organizationId }, select: { id: true } }))) throw new BadRequestException('Организация не найдена');
    const a = await this.prisma.donationAgreement.create({
      data: { ...dto, signedAt: dto.signedAt ? new Date(dto.signedAt.slice(0, 10)) : null, amount: dto.amount ?? null },
    });
    await this.audit.log({ actorUserId: actor.id, action: 'agreement.created', entityType: 'Agreement', entityId: a.id, after: a, meta });
    return a;
  }

  async updateAgreement(id: string, dto: UpdateAgreementDto, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const before = await this.prisma.donationAgreement.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Договор не найден');
    const a = await this.prisma.donationAgreement.update({
      where: { id },
      data: { ...dto, signedAt: dto.signedAt === undefined ? undefined : dto.signedAt ? new Date(dto.signedAt.slice(0, 10)) : null },
    });
    await this.audit.log({ actorUserId: actor.id, action: 'agreement.updated', entityType: 'Agreement', entityId: id, before, after: a, meta });
    return a;
  }

  private async loadAgreement(id: string) {
    const a = await this.prisma.donationAgreement.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Договор не найден');
    return a;
  }

  async addAgreementDocument(id: string, file: UploadedFileLike | undefined, actor: AuthUser, meta: RequestMeta) {
    const a = await this.loadAgreement(id);
    const own = this.access.isOwnOrganization(actor, a.organizationId) && actor.permissions.has(P.DUES_READ_OWN);
    if (!actor.permissions.has(P.DUES_MANAGE) && !own) throw new ForbiddenException('Недостаточно прав');
    return this.attach(FileEntityType.AGREEMENT, id, file, 'AGREEMENT', actor, meta, 'Agreement');
  }

  async openAgreementDocument(id: string, fileId: string, user: AuthUser) {
    const a = await this.loadAgreement(id);
    if (!this.canSeeAgreementsOf(user, a.organizationId)) throw new NotFoundException('Не найдено');
    return this.openLinked(FileEntityType.AGREEMENT, id, fileId);
  }

  async removeAgreementDocument(id: string, fileId: string, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    await this.loadAgreement(id);
    return this.detach(FileEntityType.AGREEMENT, id, fileId, actor, meta, 'Agreement');
  }

  // ───────────── Напоминания ─────────────

  /** Получатели: активные пользователи организации + сотрудники с областью «Взносы и договоры». */
  private async recipients(organizationId: string) {
    const [users, employees] = await Promise.all([
      this.prisma.user.findMany({ where: { organizationId, status: UserStatus.ACTIVE }, select: { id: true, email: true, fullName: true } }),
      this.prisma.employee.findMany({
        where: { organizationId, email: { not: null }, responsibilities: { some: { area: { code: 'DUES' } } } },
        select: { email: true, fullName: true },
      }),
    ]);
    const byEmail = new Map<string, { email: string; fullName: string; userId?: string }>();
    for (const e of employees) byEmail.set(e.email!.toLowerCase(), { email: e.email!, fullName: e.fullName });
    for (const u of users) byEmail.set(u.email, { email: u.email, fullName: u.fullName, userId: u.id });
    return [...byEmail.values()];
  }

  private async sendReminder(duesId: string, kind: string): Promise<boolean> {
    // Уникальный индекс (dues_id, kind): одно и то же напоминание не уйдёт дважды
    const created = await this.prisma.duesReminderLog.createMany({ data: [{ duesId, kind }], skipDuplicates: true });
    if (!created.count) return false;
    const d = await this.load(duesId);
    const [t] = await this.withTotals([d]);
    const vars = {
      organization: d.organization.name,
      year: String(d.year),
      amountDue: fmtRub(toKop(t.amountDue)),
      paid: fmtRub(toKop(t.paid)),
      debt: fmtRub(toKop(t.debt)),
      dueDate: fmtDate(d.dueDate),
      state: d.status === DuesStatus.OVERDUE ? 'просрочен' : 'напоминание',
      link: `${env.appUrl}/dues`,
    };
    const people = await this.recipients(d.organizationId);
    const users = people.filter((p) => p.userId);
    if (users.length) {
      await this.prisma.notification.createMany({
        data: users.map((u) => ({
          userId: u.userId!,
          type: 'DUES_REMINDER',
          title: `Членский взнос за ${d.year} год`,
          body: `К оплате ${vars.debt} ₽, срок ${vars.dueDate}`,
          link: '/dues',
        })),
      });
    }
    for (const p of people) {
      this.mail.sendTemplate('DUES_REMINDER', p.email, { ...vars, fullName: p.fullName }).catch((e: unknown) => this.logger.error(`Напоминание ${p.email}: ${String(e)}`));
    }
    return true;
  }

  /** Ручная рассылка должникам года (не чаще раза в день на организацию). */
  async remindDebtors(year: number, actor: AuthUser, meta: RequestMeta) {
    this.assertManage(actor);
    const debtors = await this.prisma.dues.findMany({ where: { year, organization: { isDemo: false }, status: { in: DEBT_STATUSES } }, select: { id: true } });
    let sent = 0;
    for (const d of debtors) if (await this.sendReminder(d.id, `manual_${mskToday()}`)) sent++;
    await this.audit.log({ actorUserId: actor.id, action: 'dues.reminders_sent', entityType: 'DuesSettings', entityId: String(year), after: { sent, debtors: debtors.length }, meta });
    return { sent, debtors: debtors.length, skipped: debtors.length - sent };
  }

  /** Плановые напоминания (вызывается планировщиком). */
  async sendScheduledReminders(now = new Date()) {
    const daysBefore = await this.settings.get<number[]>('dues.reminderDaysBefore', [30, 7]);
    const open = await this.prisma.dues.findMany({ where: { status: { in: DEBT_STATUSES } }, include: { settings: { select: { graceDays: true } } } });
    let sent = 0;
    for (const d of open) {
      const kind = reminderKind({ dueDate: d.dueDate, graceDays: d.settings.graceDays, daysBefore, now });
      if (kind && (await this.sendReminder(d.id, kind))) sent++;
    }
    return sent;
  }

  /** Для голосований: требуется ли оплаченный взнос текущего года. */
  async votingRequiresPaid(year = mskYear()) {
    const s = await this.prisma.duesSettings.findUnique({ where: { year }, select: { votingRequiresPaid: true } });
    return !!s?.votingRequiresPaid;
  }
}

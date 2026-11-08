import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FileEntityType, PresenceStatus, Prisma, ProtocolStatus, WgRole } from '@prisma/client';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Page, pageArgs } from '../common/pagination';
import { fmtMsk } from '../common/time';
import { EventsService } from '../events/events.service';
import { FilesService, UploadedFileLike } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { VoteResult } from '../votes/vote-logic';
import { ProtocolDto, ProtocolListQuery } from './protocols.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts');
const font = (n: string) => Buffer.from(vfs[n], 'base64');
const printer = new PdfPrinter({ Roboto: { normal: font('Roboto-Regular.ttf'), bold: font('Roboto-Medium.ttf'), italics: font('Roboto-Italic.ttf'), bolditalics: font('Roboto-MediumItalic.ttf') } });

const INCLUDE = {
  items: { orderBy: { position: 'asc' }, include: { vote: { select: { id: true, number: true, title: true, status: true, result: true } } } },
  event: { select: { id: true, title: true, type: true, format: true, location: true, startsAt: true, workingGroupId: true } },
  workingGroup: { select: { id: true, name: true } },
  author: { select: { id: true, fullName: true } },
} satisfies Prisma.ProtocolInclude;
type ProtocolFull = Prisma.ProtocolGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class ProtocolsService {
  private readonly logger = new Logger('Protocols');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Доступ ─────────────

  /** Протокол ведут секретарь/админ; протокол рабочей группы — также её руководитель. */
  private async canManage(u: AuthUser, workingGroupId: string | null): Promise<boolean> {
    if (u.permissions.has(P.PROTOCOLS_MANAGE)) return true;
    if (!workingGroupId) return false;
    const m = await this.prisma.workingGroupMember.findUnique({ where: { workingGroupId_userId: { workingGroupId, userId: u.id } } });
    return m?.role === WgRole.LEAD;
  }

  private async ledGroups(u: AuthUser): Promise<string[]> {
    const rows = await this.prisma.workingGroupMember.findMany({ where: { userId: u.id, role: WgRole.LEAD }, select: { workingGroupId: true } });
    return rows.map((r) => r.workingGroupId);
  }

  /** Опубликованные — членам и «видящим всё»; партнёрам — отмеченные для партнёров; черновики — тем, кто ведёт. */
  private async visibilityWhere(u: AuthUser): Promise<Prisma.ProtocolWhereInput> {
    if (u.permissions.has(P.PROTOCOLS_MANAGE)) return {};
    const led = await this.ledGroups(u);
    const published: Prisma.ProtocolWhereInput = u.permissions.has(P.PROTOCOLS_READ)
      ? { status: ProtocolStatus.PUBLISHED }
      : u.permissions.has(P.PARTNER_MATERIALS_READ)
        ? { status: ProtocolStatus.PUBLISHED, OR: [{ visibleToPartners: true }, { workingGroup: { members: { some: { userId: u.id } } } }] }
        : { id: { in: [] } };
    // Протоколы правления видны только его участникам
    const closed = { isBoard: true, members: { none: { userId: u.id } } };
    const board: Prisma.ProtocolWhereInput = { NOT: [{ workingGroup: closed }, { event: { workingGroup: closed } }] };
    return { AND: [board, led.length ? { OR: [published, { workingGroupId: { in: led } }] } : published] };
  }

  private async load(id: string, u: AuthUser): Promise<ProtocolFull> {
    const p = await this.prisma.protocol.findFirst({ where: { id, ...(await this.visibilityWhere(u)) }, include: INCLUDE });
    if (!p) throw new NotFoundException('Протокол не найден');
    return p;
  }

  private async loadForManage(id: string, u: AuthUser): Promise<ProtocolFull> {
    const p = await this.load(id, u);
    if (!(await this.canManage(u, p.workingGroupId))) throw new ForbiddenException('Недостаточно прав');
    return p;
  }

  // ───────────── Чтение ─────────────

  async list(q: ProtocolListQuery, u: AuthUser): Promise<Page<unknown>> {
    const and: Prisma.ProtocolWhereInput[] = [await this.visibilityWhere(u)];
    if (q.status) and.push({ status: q.status });
    if (q.eventType) and.push({ event: { type: q.eventType } });
    if (q.workingGroupId) and.push({ workingGroupId: q.workingGroupId });
    if (q.generalOnly) and.push({ workingGroupId: null });
    if (q.year) and.push({ heldAt: { gte: new Date(Date.UTC(q.year, 0, 1) - 3 * 3_600_000), lt: new Date(Date.UTC(q.year + 1, 0, 1) - 3 * 3_600_000) } });
    if (q.search) and.push({ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { number: { contains: q.search, mode: 'insensitive' } }, { items: { some: { decision: { contains: q.search, mode: 'insensitive' } } } }] });
    const where: Prisma.ProtocolWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.protocol.findMany({
        where,
        include: { event: { select: { id: true, title: true, type: true } }, workingGroup: { select: { id: true, name: true } }, author: { select: { id: true, fullName: true } }, _count: { select: { items: true } } },
        orderBy: { heldAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.protocol.count({ where }),
    ]);
    return { items: rows, total, page: q.page, pageSize: q.pageSize };
  }

  private attachments(id: string) {
    return this.prisma.fileLink
      .findMany({
        where: { entityType: FileEntityType.PROTOCOL, entityId: id },
        include: { file: { select: { id: true, originalName: true, mime: true, size: true, createdAt: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((ls) => ls.map((l) => l.file));
  }

  /** Присутствовавшие организации (для протокола мероприятия). */
  private async presentOrganizations(eventId: string | null) {
    if (!eventId) return null;
    const rows = await this.prisma.eventAttendance.findMany({
      where: { eventId, presence: { in: [PresenceStatus.PRESENT_OFFLINE, PresenceStatus.PRESENT_ONLINE] }, organizationId: { not: null } },
      select: { organization: { select: { id: true, name: true, shortName: true } } },
    });
    const uniq = new Map(rows.map((r) => [r.organization!.id, r.organization!.shortName || r.organization!.name]));
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { type: true, workingGroupId: true } });
    return { invited: (await this.events.audienceOrgIds(event)).length, present: [...uniq.values()].sort((a, b) => a.localeCompare(b, 'ru')) };
  }

  async get(id: string, u: AuthUser) {
    const p = await this.load(id, u);
    return {
      ...p,
      items: p.items.map((i) => ({ ...i, vote: i.vote ? { ...i.vote, result: undefined, outcome: (i.vote.result as unknown as VoteResult | null)?.questions.map((q) => q.outcome.label) ?? null } : null })),
      attachments: await this.attachments(id),
      attendance: await this.presentOrganizations(p.eventId),
      canManage: await this.canManage(u, p.workingGroupId),
    };
  }

  // ───────────── Изменение ─────────────

  private async resolveContext(dto: ProtocolDto) {
    let workingGroupId = dto.workingGroupId ?? null;
    if (dto.eventId) {
      const e = await this.prisma.event.findUnique({ where: { id: dto.eventId } });
      if (!e) throw new BadRequestException('Мероприятие не найдено');
      workingGroupId = e.workingGroupId ?? workingGroupId;
    }
    if (workingGroupId && !(await this.prisma.workingGroup.findUnique({ where: { id: workingGroupId } }))) throw new BadRequestException('Рабочая группа не найдена');
    const voteIds = dto.items.map((i) => i.voteId).filter((x): x is string => !!x);
    if (voteIds.length && (await this.prisma.vote.count({ where: { id: { in: voteIds } } })) !== new Set(voteIds).size) throw new BadRequestException('Голосование не найдено');
    return workingGroupId;
  }

  async create(dto: ProtocolDto, u: AuthUser, meta: RequestMeta) {
    const workingGroupId = await this.resolveContext(dto);
    if (!(await this.canManage(u, workingGroupId))) throw new ForbiddenException('Недостаточно прав');
    const p = await this.prisma.protocol.create({
      data: {
        title: dto.title,
        number: dto.number,
        heldAt: new Date(dto.heldAt),
        eventId: dto.eventId ?? null,
        workingGroupId,
        visibleToPartners: dto.visibleToPartners ?? false,
        authorId: u.id,
        items: { create: dto.items.map((i, position) => ({ position, agendaText: i.agendaText, discussion: i.discussion, decision: i.decision, voteId: i.voteId })) },
      },
      include: INCLUDE,
    });
    await this.audit.log({ actorUserId: u.id, action: 'protocol.created', entityType: 'Protocol', entityId: p.id, after: p, meta });
    return p;
  }

  async update(id: string, dto: ProtocolDto, u: AuthUser, meta: RequestMeta) {
    const before = await this.loadForManage(id, u);
    if (before.status !== ProtocolStatus.DRAFT) throw new ConflictException('Опубликованный протокол не редактируется. Верните его в черновик.');
    const workingGroupId = await this.resolveContext(dto);
    if (!(await this.canManage(u, workingGroupId))) throw new ForbiddenException('Недостаточно прав');
    return this.prisma.$transaction(async (tx) => {
      await tx.protocolItem.deleteMany({ where: { protocolId: id } });
      const p = await tx.protocol.update({
        where: { id },
        data: {
          title: dto.title,
          number: dto.number,
          heldAt: new Date(dto.heldAt),
          eventId: dto.eventId ?? null,
          workingGroupId,
          visibleToPartners: dto.visibleToPartners ?? false,
          items: { create: dto.items.map((i, position) => ({ position, agendaText: i.agendaText, discussion: i.discussion, decision: i.decision, voteId: i.voteId })) },
        },
        include: INCLUDE,
      });
      await this.audit.log({ actorUserId: u.id, action: 'protocol.updated', entityType: 'Protocol', entityId: id, before, after: p, meta }, tx);
      return p;
    });
  }

  async publish(id: string, u: AuthUser, meta: RequestMeta) {
    const p = await this.loadForManage(id, u);
    if (p.status !== ProtocolStatus.DRAFT) throw new ConflictException('Протокол уже опубликован');
    if (!p.items.length) throw new BadRequestException('Добавьте хотя бы один пункт повестки');
    const after = await this.prisma.protocol.update({ where: { id }, data: { status: ProtocolStatus.PUBLISHED, publishedAt: new Date() } });
    await this.audit.log({ actorUserId: u.id, action: 'protocol.published', entityType: 'Protocol', entityId: id, after: { status: after.status }, meta });
    // Уведомление в ленту участникам мероприятия (или группы)
    const target = p.event ?? (p.workingGroupId ? { type: 'WORKING_GROUP_MEETING' as const, workingGroupId: p.workingGroupId } : null);
    if (target) {
      this.events
        .audienceUsers(target)
        .then((users) => this.notifications.notifyUsers(users, { type: 'PROTOCOL_PUBLISHED', title: `Опубликован протокол: ${p.title}`, link: `/protocols/${id}` }))
        .catch((e: unknown) => this.logger.error(String(e)));
    }
    return after;
  }

  async unpublish(id: string, u: AuthUser, meta: RequestMeta) {
    const p = await this.loadForManage(id, u);
    if (p.status !== ProtocolStatus.PUBLISHED) throw new ConflictException('Протокол не опубликован');
    const after = await this.prisma.protocol.update({ where: { id }, data: { status: ProtocolStatus.DRAFT, publishedAt: null } });
    await this.audit.log({ actorUserId: u.id, action: 'protocol.unpublished', entityType: 'Protocol', entityId: id, before: { status: p.status }, after: { status: after.status }, meta });
    return after;
  }

  async remove(id: string, u: AuthUser, meta: RequestMeta) {
    const p = await this.loadForManage(id, u);
    if (p.status !== ProtocolStatus.DRAFT) throw new ConflictException('Удалить можно только черновик');
    await this.prisma.$transaction(async (tx) => {
      await tx.fileLink.deleteMany({ where: { entityType: FileEntityType.PROTOCOL, entityId: id } });
      await tx.protocol.delete({ where: { id } });
      await this.audit.log({ actorUserId: u.id, action: 'protocol.deleted', entityType: 'Protocol', entityId: id, before: p, meta }, tx);
    });
  }

  // ───────────── Файлы ─────────────

  async addFile(id: string, file: UploadedFileLike | undefined, u: AuthUser, meta: RequestMeta) {
    await this.loadForManage(id, u);
    if (!file) throw new BadRequestException('Файл не передан');
    const saved = await this.files.save(file, u.id, {
      maxBytes: 20 * 1024 * 1024,
      allowedMime: /^(application\/pdf|image\/(png|jpeg|webp)|application\/(msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.oasis\.opendocument\.[\w.]+|zip)|text\/plain)$/,
    });
    await this.prisma.fileLink.create({ data: { fileId: saved.id, entityType: FileEntityType.PROTOCOL, entityId: id, docType: 'ATTACHMENT' } });
    await this.audit.log({ actorUserId: u.id, action: 'protocol.file_added', entityType: 'Protocol', entityId: id, after: { fileId: saved.id, name: saved.originalName }, meta });
    return { id: saved.id, originalName: saved.originalName, mime: saved.mime, size: saved.size, createdAt: saved.createdAt };
  }

  async openFile(id: string, fileId: string, u: AuthUser) {
    await this.load(id, u);
    const link = await this.prisma.fileLink.findFirst({ where: { entityType: FileEntityType.PROTOCOL, entityId: id, fileId } });
    if (!link) throw new NotFoundException('Файл не найден');
    return this.files.open(fileId);
  }

  async removeFile(id: string, fileId: string, u: AuthUser, meta: RequestMeta) {
    await this.loadForManage(id, u);
    const res = await this.prisma.fileLink.deleteMany({ where: { entityType: FileEntityType.PROTOCOL, entityId: id, fileId } });
    if (!res.count) throw new NotFoundException('Файл не найден');
    await this.audit.log({ actorUserId: u.id, action: 'protocol.file_removed', entityType: 'Protocol', entityId: id, before: { fileId }, meta });
  }

  // ───────────── PDF ─────────────

  async pdf(id: string, u: AuthUser): Promise<{ name: string; content: Buffer }> {
    const p = await this.get(id, u);
    const ACCENT = '#007b73';
    const items: Content[] = p.items.flatMap((i, n) => [
      { text: `${n + 1}. ${i.agendaText}`, bold: true, margin: [0, 12, 0, 4] },
      ...(i.discussion ? [{ text: [{ text: 'Слушали: ', bold: true }, i.discussion], margin: [0, 2, 0, 2] } as Content] : []),
      ...(i.vote ? [{ text: `Голосование № ${i.vote.number} «${i.vote.title}»: ${i.vote.outcome?.join('; ') ?? 'не завершено'}`, color: '#555', fontSize: 9, margin: [0, 2, 0, 2] } as Content] : []),
      ...(i.decision ? [{ text: [{ text: 'Решили: ', bold: true, color: ACCENT }, i.decision], margin: [0, 2, 0, 2] } as Content] : []),
    ]);
    const def: TDocumentDefinitions = {
      pageSize: 'A4',
      pageMargins: [56, 56, 48, 56],
      defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25 },
      info: { title: p.title, author: 'Альянс «Ценность каждого»' },
      footer: (page, pages) => ({ text: `стр. ${page} из ${pages}`, alignment: 'right', fontSize: 8, color: '#888', margin: [0, 16, 48, 0] }),
      content: [
        { text: 'Альянс «Ценность каждого»', color: ACCENT, bold: true },
        { text: `ПРОТОКОЛ${p.number ? ` № ${p.number}` : ''}`, fontSize: 16, bold: true, alignment: 'center', margin: [0, 12, 0, 2] },
        { text: p.title, alignment: 'center', fontSize: 12, margin: [0, 0, 0, 12] },
        { columns: [{ text: p.event?.location ?? (p.workingGroup ? p.workingGroup.name : ''), color: '#555' }, { text: fmtMsk(p.heldAt), alignment: 'right', color: '#555' }] },
        ...(p.attendance
          ? [
              { text: `Присутствовали представители ${p.attendance.present.length} из ${p.attendance.invited} приглашённых организаций:`, margin: [0, 12, 0, 2] } as Content,
              { text: p.attendance.present.join(', ') || '—', fontSize: 9.5, color: '#333' } as Content,
            ]
          : []),
        { text: 'Повестка и решения', bold: true, color: ACCENT, fontSize: 12, margin: [0, 16, 0, 0] },
        ...items,
        ...(p.attachments.length ? [{ text: 'Приложения', bold: true, color: ACCENT, margin: [0, 16, 0, 4] } as Content, { ul: p.attachments.map((a) => a.originalName) } as Content] : []),
        {
          unbreakable: true,
          stack: [
            { text: `Протокол вёл(а): ${p.author.fullName}`, margin: [0, 24, 0, 24], fontSize: 9, color: '#555' },
            {
              columns: [
                { text: 'Председатель\n\n_______________________ / ____________________', width: '*' },
                { text: 'Секретарь\n\n_______________________ / ____________________', width: '*' },
              ],
            },
          ],
        },
      ],
    };
    const content = await new Promise<Buffer>((resolve, reject) => {
      const doc = printer.createPdfKitDocument(def);
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
    return { name: `Протокол${p.number ? ` ${p.number}` : ''} от ${p.heldAt.toISOString().slice(0, 10)}.pdf`, content };
  }
}

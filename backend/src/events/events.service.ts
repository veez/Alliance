import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventFormat, EventStatus, EventType, OrganizationStatus, PresenceStatus, Prisma, ProtocolStatus, RegistrationStatus, UserStatus, VoteStatus } from '@prisma/client';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Page, pageArgs } from '../common/pagination';
import { fmtMsk, mskYear } from '../common/time';
import { env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeActivity, icsDate, icsText, registrationOpen } from './events-logic';
import { AttendanceDto, CreateEventDto, EventListQuery, UpdateEventDto } from './events.dto';

const FORMAT_LABEL: Record<EventFormat, string> = { OFFLINE: 'очно', ONLINE: 'онлайн', HYBRID: 'очно и онлайн' };
const PRESENT: PresenceStatus[] = [PresenceStatus.PRESENT_OFFLINE, PresenceStatus.PRESENT_ONLINE];
const CONFIRMED: RegistrationStatus[] = [RegistrationStatus.CONFIRMED_OFFLINE, RegistrationStatus.CONFIRMED_ONLINE];

const EVENT_INCLUDE = {
  workingGroup: { select: { id: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.EventInclude;
type EventRow = Prisma.EventGetPayload<{ include: typeof EVENT_INCLUDE }>;

@Injectable()
export class EventsService {
  private readonly logger = new Logger('Events');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Доступ и аудитория ─────────────

  canManage(u: AuthUser) {
    return u.permissions.has(P.EVENTS_MANAGE);
  }

  private seesAll(u: AuthUser) {
    return this.canManage(u) || u.permissions.has(P.ORGS_READ_ALL);
  }

  /** Члены Альянса видят все мероприятия, партнёры — открытые для партнёров. */
  private visibilityWhere(u: AuthUser): Prisma.EventWhereInput {
    if (this.seesAll(u) || u.permissions.has(P.EVENTS_PARTICIPATE)) return {};
    if (u.permissions.has(P.PARTNER_MATERIALS_READ)) return { visibleToPartners: true };
    return { id: { in: [] } };
  }

  private async loadVisible(id: string, u: AuthUser): Promise<EventRow> {
    const e = await this.prisma.event.findFirst({ where: { id, ...this.visibilityWhere(u) }, include: EVENT_INCLUDE });
    if (!e) throw new NotFoundException('Мероприятие не найдено');
    return e;
  }

  /** Приглашённые пользователи: заседание РГ — участники группы; остальное — пользователи организаций-членов. */
  async audienceUsers(e: { type: EventType; workingGroupId: string | null }) {
    if (e.type === EventType.WORKING_GROUP_MEETING && e.workingGroupId) {
      const members = await this.prisma.workingGroupMember.findMany({
        where: { workingGroupId: e.workingGroupId, user: { status: UserStatus.ACTIVE } },
        select: { user: { select: { id: true, email: true, fullName: true, organizationId: true } } },
      });
      return members.map((m) => m.user);
    }
    return this.prisma.user.findMany({
      where: { status: UserStatus.ACTIVE, organization: { status: OrganizationStatus.MEMBER } },
      select: { id: true, email: true, fullName: true, organizationId: true },
    });
  }

  async audienceOrgIds(e: { type: EventType; workingGroupId: string | null }): Promise<string[]> {
    if (e.type === EventType.WORKING_GROUP_MEETING && e.workingGroupId) {
      const users = await this.audienceUsers(e);
      return [...new Set(users.map((u) => u.organizationId).filter((x): x is string => !!x))];
    }
    return (await this.prisma.organization.findMany({ where: { status: OrganizationStatus.MEMBER }, select: { id: true } })).map((o) => o.id);
  }

  private async canRegister(e: EventRow, u: AuthUser) {
    if (!registrationOpen(e)) return false;
    if (e.type === EventType.WORKING_GROUP_MEETING && e.workingGroupId) {
      return !!(await this.prisma.workingGroupMember.findUnique({ where: { workingGroupId_userId: { workingGroupId: e.workingGroupId, userId: u.id } } }));
    }
    if (u.permissions.has(P.EVENTS_PARTICIPATE)) return true;
    return e.visibleToPartners && u.permissions.has(P.PARTNER_MATERIALS_READ);
  }

  // ───────────── Список и карточка ─────────────

  async list(q: EventListQuery, u: AuthUser): Promise<Page<unknown>> {
    const now = new Date();
    const and: Prisma.EventWhereInput[] = [this.visibilityWhere(u)];
    if (q.scope === 'upcoming') and.push({ OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } }], status: { not: EventStatus.CANCELLED } });
    if (q.scope === 'past') and.push({ OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: now } }] });
    if (q.from || q.to) and.push({ startsAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } });
    if (q.type) and.push({ type: q.type });
    if (q.status) and.push({ status: q.status });
    if (q.workingGroupId) and.push({ workingGroupId: q.workingGroupId });
    if (q.search) and.push({ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { location: { contains: q.search, mode: 'insensitive' } }] });
    const where: Prisma.EventWhereInput = { AND: and };
    const manage = this.canManage(u);
    const [rows, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: {
          ...EVENT_INCLUDE,
          attendance: { where: { userId: u.id }, select: { registration: true, presence: true } },
          protocols: { where: manage ? {} : { status: ProtocolStatus.PUBLISHED }, select: { id: true, number: true, status: true } },
        },
        orderBy: { startsAt: q.scope === 'past' ? 'desc' : 'asc' },
        ...pageArgs(q),
      }),
      this.prisma.event.count({ where }),
    ]);
    const counts = await this.prisma.eventAttendance.groupBy({ by: ['eventId', 'registration'], where: { eventId: { in: rows.map((r) => r.id) } }, _count: true });
    const items = await Promise.all(
      rows.map(async ({ attendance, ...e }) => ({
        ...e,
        my: attendance[0] ?? null,
        canRegister: await this.canRegister(e, u),
        registrations: {
          offline: counts.find((c) => c.eventId === e.id && c.registration === RegistrationStatus.CONFIRMED_OFFLINE)?._count ?? 0,
          online: counts.find((c) => c.eventId === e.id && c.registration === RegistrationStatus.CONFIRMED_ONLINE)?._count ?? 0,
          declined: counts.find((c) => c.eventId === e.id && c.registration === RegistrationStatus.DECLINED)?._count ?? 0,
        },
      })),
    );
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, u: AuthUser) {
    const e = await this.loadVisible(id, u);
    const manage = this.canManage(u);
    const [mine, rows, protocols, audienceOrgs] = await Promise.all([
      this.prisma.eventAttendance.findUnique({ where: { eventId_userId: { eventId: id, userId: u.id } } }),
      this.prisma.eventAttendance.findMany({
        where: { eventId: id },
        include: { user: { select: { id: true, fullName: true } }, organization: { select: { id: true, name: true, shortName: true } } },
      }),
      this.prisma.protocol.findMany({
        where: { eventId: id, ...(manage ? {} : { status: ProtocolStatus.PUBLISHED }) },
        select: { id: true, number: true, title: true, status: true, publishedAt: true },
      }),
      this.audienceOrgIds(e),
    ]);
    const presentOrgs = new Set(rows.filter((r) => PRESENT.includes(r.presence) && r.organizationId).map((r) => r.organizationId!));
    const summary = {
      invitedOrganizations: audienceOrgs.length,
      confirmedOffline: rows.filter((r) => r.registration === RegistrationStatus.CONFIRMED_OFFLINE).length,
      confirmedOnline: rows.filter((r) => r.registration === RegistrationStatus.CONFIRMED_ONLINE).length,
      declined: rows.filter((r) => r.registration === RegistrationStatus.DECLINED).length,
      presentOrganizations: [...presentOrgs].filter((o) => audienceOrgs.includes(o)).length,
      presentPeople: rows.filter((r) => PRESENT.includes(r.presence)).length,
    };

    // Список участников: для организаторов — все приглашённые, для остальных — кто подтвердил участие
    let participants: unknown[];
    if (manage) {
      const audience = await this.audienceUsers(e);
      const orgs = await this.prisma.organization.findMany({ where: { id: { in: audience.map((a) => a.organizationId!).filter(Boolean) } }, select: { id: true, name: true, shortName: true } });
      const byUser = new Map(rows.map((r) => [r.userId, r]));
      const list = audience.map((a) => {
        const r = byUser.get(a.id);
        const o = orgs.find((x) => x.id === a.organizationId);
        return {
          userId: a.id,
          fullName: a.fullName,
          organization: o ? { id: o.id, name: o.shortName || o.name } : null,
          registration: r?.registration ?? RegistrationStatus.INVITED,
          presence: r?.presence ?? PresenceStatus.UNKNOWN,
          invited: true,
        };
      });
      // Зарегистрировавшиеся вне аудитории (например, партнёры)
      for (const r of rows) {
        if (!list.some((x) => x.userId === r.userId)) {
          list.push({
            userId: r.userId,
            fullName: r.user.fullName,
            organization: r.organization ? { id: r.organization.id, name: r.organization.shortName || r.organization.name } : null,
            registration: r.registration,
            presence: r.presence,
            invited: false,
          });
        }
      }
      participants = list.sort((a, b) => (a.organization?.name ?? '').localeCompare(b.organization?.name ?? '', 'ru'));
    } else {
      participants = rows
        .filter((r) => CONFIRMED.includes(r.registration))
        .map((r) => ({ fullName: r.user.fullName, organization: r.organization ? r.organization.shortName || r.organization.name : null, registration: r.registration }));
    }

    return {
      ...e,
      my: mine ? { registration: mine.registration, presence: mine.presence } : null,
      canRegister: await this.canRegister(e, u),
      canManage: manage,
      summary,
      participants,
      protocols,
    };
  }

  // ───────────── Создание и изменение ─────────────

  private async validate(dto: Partial<CreateEventDto>, existing?: EventRow) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing?.startsAt;
    const endsAt = dto.endsAt !== undefined ? (dto.endsAt ? new Date(dto.endsAt) : null) : existing?.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('Окончание должно быть позже начала');
    const deadline = dto.registrationDeadline !== undefined ? (dto.registrationDeadline ? new Date(dto.registrationDeadline) : null) : existing?.registrationDeadline;
    if (startsAt && deadline && deadline > startsAt) throw new BadRequestException('Регистрация должна закончиться до начала мероприятия');
    const type = dto.type ?? existing?.type;
    const wg = dto.workingGroupId !== undefined ? dto.workingGroupId : existing?.workingGroupId;
    if (type === EventType.WORKING_GROUP_MEETING && !wg) throw new BadRequestException('Для заседания рабочей группы выберите группу');
    if (wg && !(await this.prisma.workingGroup.findUnique({ where: { id: wg } }))) throw new BadRequestException('Рабочая группа не найдена');
    const format = dto.format ?? existing?.format;
    const location = dto.location !== undefined ? dto.location : existing?.location;
    if (format !== EventFormat.ONLINE && !location) throw new BadRequestException('Укажите место проведения');
  }

  private eventData(dto: Partial<CreateEventDto>): Prisma.EventUncheckedUpdateInput {
    const date = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
    return {
      title: dto.title,
      description: dto.description,
      type: dto.type,
      format: dto.format,
      location: dto.location,
      onlineUrl: dto.onlineUrl,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      endsAt: date(dto.endsAt),
      registrationDeadline: date(dto.registrationDeadline),
      workingGroupId: dto.type && dto.type !== EventType.WORKING_GROUP_MEETING ? null : dto.workingGroupId,
      visibleToPartners: dto.visibleToPartners,
    };
  }

  async create(dto: CreateEventDto, u: AuthUser, meta: RequestMeta) {
    if (!this.canManage(u)) throw new ForbiddenException('Недостаточно прав');
    await this.validate(dto);
    const e = await this.prisma.event.create({
      data: { ...(this.eventData(dto) as Prisma.EventUncheckedCreateInput), title: dto.title, type: dto.type, format: dto.format, startsAt: new Date(dto.startsAt), createdById: u.id },
      include: EVENT_INCLUDE,
    });
    await this.audit.log({ actorUserId: u.id, action: 'event.created', entityType: 'Event', entityId: e.id, after: e, meta });
    if (dto.notify !== false && e.startsAt > new Date()) {
      this.invite(e).catch((err: unknown) => this.logger.error(String(err)));
    }
    return e;
  }

  private emailVars(e: EventRow) {
    const where = e.format === EventFormat.ONLINE ? '' : e.location ? `, место: ${e.location}` : '';
    return { when: fmtMsk(e.startsAt), format: FORMAT_LABEL[e.format], where };
  }

  private async invite(e: EventRow) {
    const users = await this.audienceUsers(e);
    await this.notifications.notifyUsers(users, {
      type: 'EVENT_INVITE',
      title: e.title,
      body: `${fmtMsk(e.startsAt)} (МСК), ${FORMAT_LABEL[e.format]}. Подтвердите участие.`,
      link: `/events/${e.id}`,
      emailTemplate: 'EVENT_INVITE',
      vars: this.emailVars(e),
    });
  }

  async update(id: string, dto: UpdateEventDto, u: AuthUser, meta: RequestMeta) {
    if (!this.canManage(u)) throw new ForbiddenException('Недостаточно прав');
    const before = await this.loadVisible(id, u);
    if (before.status === EventStatus.CANCELLED) throw new ConflictException('Мероприятие отменено');
    await this.validate(dto, before);
    const e = await this.prisma.event.update({
      where: { id },
      data: { ...this.eventData(dto), reminderSentAt: dto.startsAt && new Date(dto.startsAt).getTime() !== before.startsAt.getTime() ? null : undefined },
      include: EVENT_INCLUDE,
    });
    await this.audit.log({ actorUserId: u.id, action: 'event.updated', entityType: 'Event', entityId: id, before, after: e, meta });
    return e;
  }

  async cancel(id: string, u: AuthUser, meta: RequestMeta) {
    if (!this.canManage(u)) throw new ForbiddenException('Недостаточно прав');
    const e = await this.loadVisible(id, u);
    if (e.status !== EventStatus.PLANNED) throw new ConflictException('Отменить можно только запланированное мероприятие');
    const after = await this.prisma.event.update({ where: { id }, data: { status: EventStatus.CANCELLED }, include: EVENT_INCLUDE });
    await this.audit.log({ actorUserId: u.id, action: 'event.cancelled', entityType: 'Event', entityId: id, before: { status: e.status }, after: { status: after.status }, meta });
    const registered = await this.prisma.eventAttendance.findMany({
      where: { eventId: id, registration: { in: CONFIRMED } },
      select: { user: { select: { id: true, email: true, fullName: true } } },
    });
    this.notifications
      .notifyUsers(
        registered.map((r) => r.user),
        { type: 'EVENT_CANCELLED', title: `Отменено: ${e.title}`, link: `/events/${id}`, emailTemplate: 'EVENT_CANCELLED', vars: { ...this.emailVars(e), title: e.title } },
      )
      .catch((err: unknown) => this.logger.error(String(err)));
    return after;
  }

  // ───────────── Участие ─────────────

  async register(id: string, registration: RegistrationStatus, u: AuthUser, meta: RequestMeta) {
    const e = await this.loadVisible(id, u);
    if (!registrationOpen(e)) throw new ConflictException('Регистрация закрыта');
    if (!(await this.canRegister(e, u))) throw new ForbiddenException('Вы не входите в число участников этого мероприятия');
    if (registration === RegistrationStatus.CONFIRMED_OFFLINE && e.format === EventFormat.ONLINE) throw new BadRequestException('Мероприятие проходит только онлайн');
    if (registration === RegistrationStatus.CONFIRMED_ONLINE && e.format === EventFormat.OFFLINE) throw new BadRequestException('Мероприятие проходит только очно');
    const row = await this.prisma.eventAttendance.upsert({
      where: { eventId_userId: { eventId: id, userId: u.id } },
      create: { eventId: id, userId: u.id, organizationId: u.organizationId, registration },
      update: { registration, organizationId: u.organizationId },
    });
    await this.audit.log({ actorUserId: u.id, action: 'event.registration', entityType: 'Event', entityId: id, after: { registration }, meta });
    return { registration: row.registration };
  }

  /** Отметка фактического присутствия. Первая отметка переводит мероприятие в «состоялось». */
  async markAttendance(id: string, dto: AttendanceDto, u: AuthUser, meta: RequestMeta) {
    if (!this.canManage(u)) throw new ForbiddenException('Недостаточно прав');
    const e = await this.loadVisible(id, u);
    if (e.status === EventStatus.CANCELLED) throw new ConflictException('Мероприятие отменено');
    if (e.startsAt > new Date()) throw new ConflictException('Присутствие отмечается после начала мероприятия');
    const users = await this.prisma.user.findMany({ where: { id: { in: dto.items.map((i) => i.userId) } }, select: { id: true, organizationId: true } });
    if (users.length !== new Set(dto.items.map((i) => i.userId)).size) throw new BadRequestException('Неизвестный пользователь');
    const orgOf = new Map(users.map((x) => [x.id, x.organizationId]));
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await tx.eventAttendance.upsert({
          where: { eventId_userId: { eventId: id, userId: item.userId } },
          create: { eventId: id, userId: item.userId, organizationId: orgOf.get(item.userId), presence: item.presence, markedById: u.id, markedAt: now },
          update: { presence: item.presence, markedById: u.id, markedAt: now },
        });
      }
      if (e.status === EventStatus.PLANNED) await tx.event.update({ where: { id }, data: { status: EventStatus.HELD } });
      await this.audit.log({ actorUserId: u.id, action: 'event.attendance_marked', entityType: 'Event', entityId: id, after: { items: dto.items }, meta }, tx);
    });
    return this.get(id, u);
  }

  // ───────────── Календарь (iCalendar) ─────────────

  async ics(id: string, u: AuthUser): Promise<{ name: string; content: string }> {
    const e = await this.loadVisible(id, u);
    const end = e.endsAt ?? new Date(e.startsAt.getTime() + 2 * 3_600_000);
    const description = [e.description, e.onlineUrl ? `Ссылка: ${e.onlineUrl}` : null, `${env.appUrl}/events/${e.id}`].filter(Boolean).join('\n\n');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Alliance Portal//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${e.id}@alliance-portal`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(e.startsAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(description)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      `URL:${env.appUrl}/events/${e.id}`,
      ...(e.status === EventStatus.CANCELLED ? ['STATUS:CANCELLED'] : []),
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return { name: `event-${e.startsAt.toISOString().slice(0, 10)}.ics`, content: lines.join('\r\n') };
  }

  // ───────────── Напоминания ─────────────

  /** За сутки до начала — тем, кто подтвердил участие (один раз). */
  async sendReminders(now = new Date()) {
    const soon = await this.prisma.event.findMany({
      where: { status: EventStatus.PLANNED, reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) } },
      include: EVENT_INCLUDE,
    });
    let sent = 0;
    for (const e of soon) {
      const claimed = await this.prisma.event.updateMany({ where: { id: e.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (!claimed.count) continue;
      const rows = await this.prisma.eventAttendance.findMany({
        where: { eventId: e.id, registration: { in: CONFIRMED } },
        select: { registration: true, user: { select: { id: true, email: true, fullName: true } } },
      });
      for (const r of rows) {
        const where = r.registration === RegistrationStatus.CONFIRMED_ONLINE ? (e.onlineUrl ? `Ссылка для подключения: ${e.onlineUrl}` : '') : e.location ? `Место: ${e.location}` : '';
        await this.notifications.notifyUsers([r.user], { type: 'EVENT_REMINDER', title: `Завтра: ${e.title}`, link: `/events/${e.id}`, emailTemplate: 'EVENT_REMINDER', vars: { when: fmtMsk(e.startsAt), where } });
        sent++;
      }
    }
    return sent;
  }

  // ───────────── Статистика активности ─────────────

  async stats(year: number | undefined, u: AuthUser) {
    if (!u.permissions.has(P.EVENTS_PARTICIPATE) && !this.seesAll(u)) throw new ForbiddenException('Недостаточно прав');
    const y = year ?? mskYear();
    const from = new Date(Date.UTC(y, 0, 1) - 3 * 3_600_000);
    const to = new Date(Date.UTC(y + 1, 0, 1) - 3 * 3_600_000);
    const [orgs, events, votes] = await Promise.all([
      this.prisma.organization.findMany({ where: { status: OrganizationStatus.MEMBER }, select: { id: true, name: true, shortName: true } }),
      this.prisma.event.findMany({ where: { status: EventStatus.HELD, startsAt: { gte: from, lt: to } }, select: { id: true, type: true, workingGroupId: true, title: true, startsAt: true } }),
      this.prisma.vote.findMany({
        where: { status: VoteStatus.CLOSED, closedAt: { gte: from, lt: to } },
        select: { eligibleVoters: { select: { organizationId: true } }, participations: { select: { organizationId: true } } },
      }),
    ]);
    const eventsWithAudience = await Promise.all(events.map(async (e) => ({ ...e, audience: await this.audienceOrgIds(e) })));
    const presence = await this.prisma.eventAttendance.findMany({
      where: { eventId: { in: events.map((e) => e.id) }, presence: { in: PRESENT }, organizationId: { not: null } },
      select: { eventId: true, organizationId: true },
    });
    const rows = computeActivity({
      orgs: orgs.map((o) => ({ id: o.id, name: o.shortName || o.name })),
      events: eventsWithAudience.map((e) => ({ id: e.id, audience: e.audience })),
      presence: presence.map((p) => ({ eventId: p.eventId, organizationId: p.organizationId! })),
      votes: votes.map((v) => ({ eligible: v.eligibleVoters.map((x) => x.organizationId), voted: v.participations.map((x) => x.organizationId) })),
    });
    const perEvent = eventsWithAudience.map((e) => {
      const orgsPresent = new Set(presence.filter((p) => p.eventId === e.id && e.audience.includes(p.organizationId!)).map((p) => p.organizationId));
      return { id: e.id, title: e.title, startsAt: e.startsAt, type: e.type, invited: e.audience.length, present: orgsPresent.size };
    });
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    return {
      year: y,
      totals: {
        eventsHeld: events.length,
        averageAttendance: avg(perEvent.filter((e) => e.invited).map((e) => (e.present / e.invited) * 100)),
        votesClosed: votes.length,
        averageTurnout: avg(votes.filter((v) => v.eligibleVoters.length).map((v) => (v.participations.length / v.eligibleVoters.length) * 100)),
      },
      events: perEvent.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()),
      rating: rows,
    };
  }
}

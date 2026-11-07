/** Демо-мероприятия, участие и протоколы (этап 4). Добавляются, если мероприятий ещё нет. Даты — относительно сегодня. */
import { EventFormat, EventStatus, EventType, PresenceStatus, PrismaClient, RegistrationStatus } from '@prisma/client';

const DAY = 86_400_000;

/** Дата через n дней в HH:MM по Москве */
function at(days: number, hh: number, mm = 0): Date {
  const d = new Date(Date.now() + days * DAY);
  const msk = new Date(d.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), hh - 3, mm));
}

export async function seedEvents(prisma: PrismaClient) {
  if (await prisma.event.count()) {
    console.log('Мероприятия уже есть — демо-мероприятия не добавляются');
    return;
  }
  const secretary = await prisma.user.findUnique({ where: { email: 'secretary@alliance.local' } });
  if (!secretary) return;
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@alliance.local' }, organizationId: { not: null } } });
  const u = (login: string) => users.find((x) => x.email === `${login}@alliance.local`);
  const wg = async (prefix: string) => (await prisma.workingGroup.findFirst({ where: { name: { startsWith: prefix } } }))?.id ?? null;
  const election = await prisma.vote.findFirst({ where: { scenario: 'ELECTION', status: 'CLOSED' } });

  type Mark = [login: string, registration: RegistrationStatus, presence?: PresenceStatus];
  async function event(data: {
    title: string;
    description?: string;
    type: EventType;
    format: EventFormat;
    location?: string;
    onlineUrl?: string;
    startsAt: Date;
    endsAt?: Date;
    registrationDeadline?: Date;
    workingGroupId?: string | null;
    visibleToPartners?: boolean;
    status?: EventStatus;
    marks?: Mark[];
  }) {
    const { marks, ...rest } = data;
    const e = await prisma.event.create({ data: { ...rest, status: rest.status ?? 'PLANNED', createdById: secretary!.id } });
    for (const [login, registration, presence] of marks ?? []) {
      const user = u(login);
      if (!user) continue;
      await prisma.eventAttendance.create({
        data: {
          eventId: e.id,
          userId: user.id,
          organizationId: user.organizationId,
          registration,
          presence: presence ?? 'UNKNOWN',
          markedById: presence ? secretary!.id : null,
          markedAt: presence ? data.endsAt ?? data.startsAt : null,
        },
      });
    }
    return e;
  }

  // Прошедшие
  const general = await event({
    title: 'Общее собрание членов Альянса',
    description: 'Повестка:\n1. Итоги работы за 9 месяцев.\n2. Утверждение итогов выборов координатора.\n3. План мероприятий на 2027 год.',
    type: 'GENERAL_MEETING',
    format: 'HYBRID',
    location: 'Москва, ул. Тверская, 7, конференц-зал',
    onlineUrl: 'https://meet.example.org/alliance-general',
    startsAt: at(-28, 11),
    endsAt: at(-28, 15),
    status: 'HELD',
    marks: [
      ['opora', 'CONFIRMED_OFFLINE', 'PRESENT_OFFLINE'],
      ['apk', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['kazhdyi', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['ucmz', 'CONFIRMED_OFFLINE', 'ABSENT'],
      ['sask', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['vmeste', 'DECLINED', 'ABSENT'],
      ['belova', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
    ],
  });
  const conference = await event({
    title: 'Конференция «Семья и психическое здоровье»',
    description: 'Ежегодная конференция Альянса для специалистов помогающих профессий.',
    type: 'CONFERENCE',
    format: 'ONLINE',
    onlineUrl: 'https://meet.example.org/conference',
    startsAt: at(-120, 10),
    endsAt: at(-120, 17),
    visibleToPartners: true,
    status: 'HELD',
    marks: [
      ['opora', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['apk', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['ucmz', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['vmeste', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['izdat', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
    ],
  });
  const standards = await wg('РГ по стандартам');
  const wgMeeting = await event({
    title: 'Заседание РГ по стандартам сопровождения семьи',
    type: 'WORKING_GROUP_MEETING',
    format: 'ONLINE',
    onlineUrl: 'https://meet.example.org/wg-standards',
    startsAt: at(-14, 16),
    endsAt: at(-14, 17, 30),
    workingGroupId: standards,
    status: 'HELD',
    marks: [
      ['opora', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['sask', 'CONFIRMED_ONLINE', 'PRESENT_ONLINE'],
      ['vmeste', 'CONFIRMED_ONLINE', 'ABSENT'],
    ],
  });

  // Предстоящие
  await event({
    title: 'Вебинар «Новые меры поддержки семей с детьми с ОВЗ»',
    description: 'Разбор изменений законодательства. Спикер — Ткаченко И. Н. (РЦ «Вместе»).',
    type: 'OTHER',
    format: 'ONLINE',
    onlineUrl: 'https://meet.example.org/webinar',
    startsAt: at(5, 15),
    endsAt: at(5, 16, 30),
    visibleToPartners: true,
    marks: [
      ['apk', 'CONFIRMED_ONLINE'],
      ['vmeste', 'CONFIRMED_ONLINE'],
    ],
  });
  await event({
    title: 'Заседание РГ по обучению специалистов',
    description: 'Обсуждение программы супервизии на 2027 год.',
    type: 'WORKING_GROUP_MEETING',
    format: 'ONLINE',
    onlineUrl: 'https://meet.example.org/wg-education',
    startsAt: at(12, 17),
    endsAt: at(12, 18, 30),
    workingGroupId: await wg('РГ по обучению'),
    marks: [['ucmz', 'CONFIRMED_ONLINE']],
  });
  await event({
    title: 'Итоговое общее собрание членов Альянса 2026',
    description: 'Повестка:\n1. Отчёт координатора за 2026 год.\n2. Утверждение плана и бюджета на 2027 год.\n3. Приём новых членов.',
    type: 'GENERAL_MEETING',
    format: 'HYBRID',
    location: 'Москва, ул. Тверская, 7, конференц-зал',
    onlineUrl: 'https://meet.example.org/alliance-final',
    startsAt: at(35, 11),
    endsAt: at(35, 16),
    registrationDeadline: at(31, 23, 59),
    marks: [
      ['apk', 'CONFIRMED_OFFLINE'],
      ['kazhdyi', 'CONFIRMED_ONLINE'],
      ['sask', 'CONFIRMED_OFFLINE'],
      ['belova', 'DECLINED'],
    ],
  });

  // Протоколы
  await prisma.protocol.create({
    data: {
      number: '3-ОС/2026',
      title: 'Протокол общего собрания членов Альянса',
      heldAt: general.startsAt,
      eventId: general.id,
      status: 'PUBLISHED',
      publishedAt: general.endsAt,
      authorId: secretary.id,
      items: {
        create: [
          { position: 0, agendaText: 'Итоги работы Альянса за 9 месяцев 2026 года', discussion: 'Координатор представила отчёт о работе рабочих групп и мероприятиях.', decision: 'Принять отчёт к сведению.' },
          {
            position: 1,
            agendaText: 'Утверждение итогов выборов координатора на 2027 год',
            discussion: 'Секретарь огласила итоги электронного голосования.',
            decision: 'Утвердить итоги голосования. Координатором Альянса на 2027 год избрана Иванова М. С.',
            voteId: election?.id,
          },
          { position: 2, agendaText: 'О плане мероприятий на 2027 год', decision: 'Поручить секретарю подготовить проект плана и вынести его на электронное голосование.' },
        ],
      },
    },
  });
  await prisma.protocol.create({
    data: {
      number: '7-РГС/2026',
      title: 'Протокол заседания РГ по стандартам сопровождения семьи',
      heldAt: wgMeeting.startsAt,
      eventId: wgMeeting.id,
      workingGroupId: standards,
      status: 'PUBLISHED',
      publishedAt: wgMeeting.endsAt,
      authorId: u('opora')?.id ?? secretary.id,
      items: {
        create: [
          { position: 0, agendaText: 'Обсуждение раздела стандарта «Первичная консультация»', decision: 'Доработать раздел с учётом замечаний, срок — 2 недели. Ответственный: Морозова А. В.' },
        ],
      },
    },
  });
  await prisma.protocol.create({
    data: {
      title: 'Протокол конференции «Семья и психическое здоровье» (черновик)',
      heldAt: conference.startsAt,
      eventId: conference.id,
      authorId: secretary.id,
      items: { create: [{ position: 0, agendaText: 'Резолюция конференции', decision: '' }] },
    },
  });
  console.log('Демо-мероприятия: 3 прошедших, 3 предстоящих, 3 протокола');
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedEvents(prisma).finally(() => prisma.$disconnect());
}

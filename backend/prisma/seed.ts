/**
 * Сиды: справочники (всегда, идемпотентно) + демо-данные (только в пустую БД, не в production).
 * Запуск: npm run seed. Полный сброс: npx prisma migrate reset (затем сиды запустятся сами).
 */
import { OrganizationKind, OrganizationStatus, PrismaClient, SystemRole, UserStatus, WgRole } from '@prisma/client';
import { encryptSecret, hashPassword, randomToken, sha256 } from '../src/auth/crypto';
import { DEFAULT_TEMPLATES } from '../src/mail/mail.service';
import { DEMO_PASSWORD, DEMO_SECRETARY_TOTP } from './data/demo';
import { REGIONS } from './data/regions';
import { seedDues } from './seed-dues';
import { seedEvents } from './seed-events';
import { seedWorkingGroups } from './seed-wg';
import { seedVotes } from './seed-votes';

const prisma = new PrismaClient();

const AREAS = [
  ['LEADERSHIP', 'Руководство и представительство'],
  ['EVENTS', 'Мероприятия'],
  ['DUES', 'Взносы и договоры'],
  ['VOTES', 'Голосования'],
  ['WORKING_GROUP', 'Рабочая группа'],
  ['DOCUMENTS', 'Документооборот'],
  ['COMMUNICATIONS', 'Коммуникации и СМИ'],
] as const;

const SETTINGS: Record<string, unknown> = {
  'votes.defaultQuorumPercent': 50,
  'votes.requirePaidDues': false,
  'votes.defaultReminders': [{ beforeHours: 48 }, { beforeHours: 2 }],
  'dues.reminderDaysBefore': [30, 7],
};

async function seedReference() {
  for (const [i, [code, name, district]] of REGIONS.entries()) {
    await prisma.region.upsert({
      where: { code },
      update: { name, federalDistrict: district, sortOrder: i },
      create: { code, name, federalDistrict: district, sortOrder: i, svgPathId: code },
    });
  }
  for (const [i, [code, name]] of AREAS.entries()) {
    await prisma.responsibilityArea.upsert({ where: { code }, update: { name, sortOrder: i }, create: { code, name, sortOrder: i } });
  }
  for (const [code, t] of Object.entries(DEFAULT_TEMPLATES)) {
    await prisma.emailTemplate.upsert({ where: { code }, update: {}, create: { code, ...t } });
  }
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }
  if (!(await prisma.workingGroup.findFirst({ where: { isBoard: true } }))) {
    await prisma.workingGroup.create({ data: { name: 'Правление Альянса', isBoard: true, goals: 'Заседания, планы работы и протоколы правления.' } });
  }
  console.log(`Справочники: ${REGIONS.length} регионов, ${AREAS.length} областей ответственности`);
}

interface DemoOrg {
  key: string;
  name: string;
  shortName?: string;
  kind?: OrganizationKind;
  status: OrganizationStatus;
  regionCode: string;
  city: string;
  head: string;
  areas: string[];
  login?: string;
}

const DEMO_ORGS: DemoOrg[] = [
  { key: 'semya', name: 'АНО «Центр поддержки семьи „Опора“»', shortName: 'Центр «Опора»', status: 'MEMBER', regionCode: 'RU-MOW', city: 'Москва', head: 'Иванова Мария Сергеевна', areas: ['сопровождение семьи', 'психологическая помощь'], login: 'opora' },
  { key: 'psy', name: 'Ассоциация психологов-консультантов Санкт-Петербурга', shortName: 'АПК СПб', status: 'MEMBER', regionCode: 'RU-SPE', city: 'Санкт-Петербург', head: 'Петров Андрей Викторович', areas: ['психическое здоровье', 'обучение специалистов'], login: 'apk' },
  { key: 'kazan', name: 'Фонд «Каждый важен»', status: 'MEMBER', regionCode: 'RU-TA', city: 'Казань', head: 'Гарипова Алсу Рашидовна', areas: ['социальная поддержка', 'инклюзия'], login: 'kazhdyi' },
  { key: 'ekb', name: 'АНО «Уральский центр ментального здоровья»', shortName: 'УЦМЗ', status: 'MEMBER', regionCode: 'RU-SVE', city: 'Екатеринбург', head: 'Смирнов Олег Игоревич', areas: ['психическое здоровье', 'профилактика'], login: 'ucmz' },
  { key: 'nsk', name: 'Сибирская ассоциация семейных консультантов', status: 'MEMBER', regionCode: 'RU-NVS', city: 'Новосибирск', head: 'Кузнецова Елена Павловна', areas: ['сопровождение семьи'], login: 'sask' },
  { key: 'krd', name: 'АНО «Южный ресурсный центр „Вместе“»', shortName: 'РЦ «Вместе»', status: 'MEMBER', regionCode: 'RU-KDA', city: 'Краснодар', head: 'Ткаченко Ирина Николаевна', areas: ['социальная поддержка', 'семьи с детьми с ОВЗ'], login: 'vmeste' },
  { key: 'expert', name: 'Белова Наталья Александровна', kind: 'INDIVIDUAL', status: 'MEMBER', regionCode: 'RU-NIZ', city: 'Нижний Новгород', head: 'Белова Наталья Александровна', areas: ['клиническая психология'], login: 'belova' },
  { key: 'cand1', name: 'АНО «Дальневосточный центр семейной психологии»', status: 'CANDIDATE', regionCode: 'RU-PRI', city: 'Владивосток', head: 'Ли Виктор Чанович', areas: ['семейная психология'], login: 'dvcsp' },
  { key: 'cand2', name: 'Благотворительный фонд «Тёплый дом»', status: 'CANDIDATE', regionCode: 'RU-ROS', city: 'Ростов-на-Дону', head: 'Орлова Светлана Юрьевна', areas: ['социальная поддержка'], login: 'teplydom' },
  { key: 'partner1', name: 'Издательство «Психология сегодня»', status: 'PARTNER', regionCode: 'RU-MOW', city: 'Москва', head: 'Соколов Дмитрий Евгеньевич', areas: ['просвещение'], login: 'izdat' },
  { key: 'partner2', name: 'Университет социальных технологий', status: 'PARTNER', regionCode: 'RU-SAM', city: 'Самара', head: 'Волкова Анна Михайловна', areas: ['образование', 'исследования'] },
];

const WORKING_GROUPS = [
  { key: 'standards', name: 'РГ по стандартам сопровождения семьи', goals: 'Разработать единые стандарты сопровождения семей для организаций-членов.' },
  { key: 'policy', name: 'РГ по взаимодействию с органами власти', goals: 'Подготовка позиций Альянса и участие в общественных слушаниях.' },
  { key: 'education', name: 'РГ по обучению специалистов', goals: 'Программа повышения квалификации и супервизии.' },
];

async function seedDemo(): Promise<boolean> {
  if (await prisma.user.count()) {
    console.log('Пользователи уже есть — демо-данные не добавляются');
    return false;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();

  const admin = await prisma.user.create({
    data: { email: 'admin@alliance.local', fullName: 'Администратор портала', systemRole: SystemRole.ADMIN, status: UserStatus.ACTIVE, passwordHash },
  });
  await prisma.user.create({
    data: {
      email: 'secretary@alliance.local',
      fullName: 'Николаева Ольга Владимировна',
      position: 'Секретарь Альянса',
      systemRole: SystemRole.SECRETARY,
      status: UserStatus.ACTIVE,
      passwordHash,
      totpSecretEnc: encryptSecret(DEMO_SECRETARY_TOTP),
      totpEnabledAt: now,
    },
  });

  const orgIds: Record<string, string> = {};
  const orgUsers: Record<string, string> = {};
  for (const [i, o] of DEMO_ORGS.entries()) {
    const org = await prisma.organization.create({
      data: {
        kind: o.kind ?? OrganizationKind.ORGANIZATION,
        status: o.status,
        name: o.name,
        shortName: o.shortName,
        regionCode: o.regionCode,
        city: o.city,
        headName: o.head,
        headPosition: o.kind === 'INDIVIDUAL' ? null : 'Директор',
        activityAreas: o.areas,
        description: `${o.name} — ${o.areas.join(', ')}.`,
        email: o.login ? `info@${o.login}.example` : null,
        phone: `+7 900 000-00-${String(10 + i).padStart(2, '0')}`,
        inn: o.kind === 'INDIVIDUAL' ? null : String(7700000000 + i * 1111),
        joinedAt: o.status === 'MEMBER' ? new Date(2024, i % 12, 1) : null,
        statusHistory: { create: { fromStatus: null, toStatus: o.status, reason: 'Демо-данные', changedById: admin.id } },
      },
    });
    orgIds[o.key] = org.id;
    if (o.login) {
      const u = await prisma.user.create({
        data: {
          email: `${o.login}@alliance.local`,
          fullName: o.head,
          position: o.kind === 'INDIVIDUAL' ? 'Член Альянса' : 'Руководитель',
          organizationId: org.id,
          status: UserStatus.ACTIVE,
          passwordHash,
        },
      });
      orgUsers[o.key] = u.id;
    }
    if (o.status === 'CANDIDATE') {
      await prisma.candidateApplication.create({
        data: { organizationId: org.id, status: 'SUBMITTED', submittedAt: now, questionnaire: { motivation: 'Хотим развивать практики сопровождения семей вместе с Альянсом.' } },
      });
    }
  }

  // Приглашённый, но ещё не активировавшийся пользователь
  await prisma.user.create({
    data: { email: 'new.member@alliance.local', fullName: 'Захаров Илья Петрович', organizationId: orgIds.ekb, status: UserStatus.INVITED },
  });
  // Пользователь с особыми правами «видеть всё» (член правления)
  await prisma.user.update({ where: { id: orgUsers.psy }, data: { canViewAll: true } });

  const wgIds: Record<string, string> = {};
  for (const wg of WORKING_GROUPS) wgIds[wg.key] = (await prisma.workingGroup.create({ data: { name: wg.name, goals: wg.goals } })).id;
  const membership: Array<[string, string, WgRole]> = [
    ['standards', 'semya', 'LEAD'],
    ['standards', 'nsk', 'MEMBER'],
    ['standards', 'krd', 'MEMBER'],
    ['policy', 'kazan', 'LEAD'],
    ['policy', 'semya', 'MEMBER'],
    ['education', 'ekb', 'LEAD'],
    ['education', 'psy', 'MEMBER'],
    ['education', 'expert', 'MEMBER'],
  ];
  for (const [wg, org, role] of membership) {
    await prisma.workingGroupMember.create({ data: { workingGroupId: wgIds[wg], userId: orgUsers[org], role } });
  }

  const areas = Object.fromEntries((await prisma.responsibilityArea.findMany()).map((a) => [a.code, a.id]));
  const employees: Array<[string, string, string, Array<[string, string?]>]> = [
    ['semya', 'Морозова Анна Викторовна', 'Координатор проектов', [['EVENTS'], ['WORKING_GROUP', 'standards']]],
    ['semya', 'Фёдоров Павел Сергеевич', 'Бухгалтер', [['DUES']]],
    ['psy', 'Егорова Татьяна Ильинична', 'Исполнительный директор', [['LEADERSHIP'], ['VOTES']]],
    ['kazan', 'Хасанов Тимур Ренатович', 'PR-менеджер', [['COMMUNICATIONS'], ['EVENTS']]],
    ['ekb', 'Лебедева Ксения Олеговна', 'Методист', [['WORKING_GROUP', 'education']]],
  ];
  for (const [n, [org, fullName, position, resp]] of employees.entries()) {
    await prisma.employee.create({
      data: {
        organizationId: orgIds[org],
        fullName,
        position,
        email: `staff${n + 1}@${org}.example`,
        responsibilities: { create: resp.map(([code, wg]) => ({ areaId: areas[code], workingGroupId: wg ? wgIds[wg] : null })) },
      },
    });
  }

  console.log(`Демо-данные: ${DEMO_ORGS.length} организаций в ${new Set(DEMO_ORGS.map((o) => o.regionCode)).size} регионах, ${WORKING_GROUPS.length} рабочие группы`);
  console.log(`Вход: admin@alliance.local / ${DEMO_PASSWORD} (при первом входе — настройка 2FA)`);
  console.log(`      secretary@alliance.local / ${DEMO_PASSWORD}, TOTP-секрет ${DEMO_SECRETARY_TOTP}`);
  console.log(`      opora@alliance.local / ${DEMO_PASSWORD} (член Альянса, руководитель РГ)`);
  return true;
}

/** Прод: при пустой БД создаёт приглашение первому администратору (ссылка — в лог). */
async function bootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email || (await prisma.user.count())) return;
  const token = randomToken();
  const user = await prisma.user.create({ data: { email, fullName: 'Администратор', systemRole: SystemRole.ADMIN, status: UserStatus.INVITED } });
  await prisma.invitation.create({
    data: { email, tokenHash: sha256(token), userId: user.id, systemRole: SystemRole.ADMIN, createdById: user.id, expiresAt: new Date(Date.now() + 3 * 86_400_000) },
  });
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  console.log(`Первый администратор ${email}: ${appUrl}/invite?token=${token} (действует 3 дня)`);
}

async function main() {
  await seedReference();
  // В production демо-данные добавляются только для демо-стенда (DEMO_DATA=true)
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_DATA !== 'true') {
    await bootstrapAdmin();
    return;
  }
  const created = await seedDemo();
  await seedVotes(prisma);
  await seedDues(prisma);
  await seedEvents(prisma);
  await seedWorkingGroups(prisma);
  // На демо-стенде всё только что созданное получает пометку «ДЕМО»
  if (created && process.env.DEMO_DATA === 'true') {
    const data = { isDemo: true };
    await prisma.$transaction([
      prisma.user.updateMany({ data }),
      prisma.organization.updateMany({ data }),
      prisma.vote.updateMany({ data }),
      prisma.event.updateMany({ data }),
      prisma.protocol.updateMany({ data }),
      prisma.workingGroup.updateMany({ where: { isBoard: false }, data }),
    ]);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

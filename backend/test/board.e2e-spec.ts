import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeAdmin } from '../prisma/make-admin';
import { removeDemo } from '../prisma/remove-demo';
import { setupBoard } from '../prisma/setup-board';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginNewCandidate, loginSecretary } from './helpers';

describe('Раздел правления (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let secretary: string;
  let outsider: string; // рядовой член Альянса
  let viewAll: string; // особые права «видеть всё», но не в правлении
  let boardMember: string;
  let boardId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
    outsider = await login(app, 'vmeste@alliance.local');
    viewAll = await login(app, 'apk@alliance.local');
    boardMember = await login(app, 'ucmz@alliance.local');
    boardId = (await prisma.workingGroup.findFirstOrThrow({ where: { isBoard: true } })).id;
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ucmz@alliance.local' } });
    await prisma.workingGroupMember.create({ data: { workingGroupId: boardId, userId: user.id } });
  });
  afterAll(() => app.close());

  it('раздел виден участникам правления, секретарю и администратору', async () => {
    await http().get(`/api/working-groups/${boardId}`).set(auth(outsider)).expect(404);
    await http().get(`/api/working-groups/${boardId}`).set(auth(viewAll)).expect(404);
    await http().post(`/api/working-groups/${boardId}/join`).set(auth(outsider)).expect(404);
    const mine = await http().get(`/api/working-groups/${boardId}`).set(auth(boardMember)).expect(200);
    expect(mine.body).toMatchObject({ isBoard: true, canJoin: false });
    const sec = await http().get(`/api/working-groups/${boardId}`).set(auth(secretary)).expect(200);
    expect(sec.body.canManage).toBe(true);
    const me = await http().get('/api/auth/me').set(auth(boardMember)).expect(200);
    expect(me.body.boardGroupId).toBe(boardId);
    const other = await http().get('/api/auth/me').set(auth(outsider)).expect(200);
    expect(other.body.boardGroupId).toBeNull();
  });

  it('правления нет в общем списке рабочих групп', async () => {
    const list = await http().get('/api/working-groups').set(auth(secretary)).expect(200);
    expect(list.body.some((g: { id: string }) => g.id === boardId)).toBe(false);
    const brief = await http().get('/api/working-groups/brief').set(auth(outsider)).expect(200);
    expect(brief.body.some((g: { id: string }) => g.id === boardId)).toBe(false);
    const forSecretary = await http().get('/api/working-groups/brief').set(auth(secretary)).expect(200);
    expect(forSecretary.body.some((g: { id: string }) => g.id === boardId)).toBe(true);
  });

  it('заседание правления видно только правлению; общие мероприятия — всем', async () => {
    const event = await http()
      .post('/api/events')
      .set(auth(secretary))
      .send({ title: 'Заседание правления', type: 'WORKING_GROUP_MEETING', format: 'ONLINE', workingGroupId: boardId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), notify: false })
      .expect(201);
    await http().get(`/api/events/${event.body.id}`).set(auth(outsider)).expect(404);
    await http().get(`/api/events/${event.body.id}`).set(auth(viewAll)).expect(404);
    await http().get(`/api/events/${event.body.id}`).set(auth(boardMember)).expect(200);
    const list = await http().get('/api/events?pageSize=200').set(auth(outsider)).expect(200);
    expect(list.body.items.some((e: { id: string }) => e.id === event.body.id)).toBe(false);
    expect(list.body.total).toBeGreaterThan(0);
    const calendar = await http().get(`/api/events?workingGroupId=${boardId}`).set(auth(boardMember)).expect(200);
    expect(calendar.body.items.map((e: { id: string }) => e.id)).toContain(event.body.id);
  });

  it('протокол правления виден только правлению', async () => {
    const author = await prisma.user.findUniqueOrThrow({ where: { email: 'secretary@alliance.local' } });
    const base = { status: 'PUBLISHED' as const, heldAt: new Date(), authorId: author.id };
    const closed = await prisma.protocol.create({ data: { ...base, title: 'Закрытый протокол', workingGroupId: boardId } });
    const open = await prisma.protocol.create({ data: { ...base, title: 'Общий протокол' } });
    await http().get(`/api/protocols/${closed.id}`).set(auth(outsider)).expect(404);
    await http().get(`/api/protocols/${closed.id}`).set(auth(viewAll)).expect(404);
    await http().get(`/api/protocols/${closed.id}`).set(auth(boardMember)).expect(200);
    const list = await http().get('/api/protocols?pageSize=100').set(auth(outsider)).expect(200);
    const ids = list.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(closed.id);
  });
});

describe('Рассылка по группам (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let secretary: string;
  let member: string;
  let candidate: string;
  let boardToken: string;
  let boardId: string;
  const http = () => request(app.getHttpServer());
  const userId = async (token: string) => (await http().get('/api/auth/me').set(auth(token)).expect(200)).body.id as string;
  const event = async (extra: Record<string, unknown>) => {
    const res = await http()
      .post('/api/events')
      .set(auth(secretary))
      .send({ title: 'Рассылка', type: 'GENERAL_MEETING', format: 'ONLINE', startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), ...extra })
      .expect(201);
    await new Promise((r) => setTimeout(r, 400)); // приглашения уходят в фоне
    return res.body as { id: string; audience: string; workingGroupId: string | null };
  };
  const got = async (token: string, eventId: string) => (await prisma.notification.count({ where: { userId: await userId(token), link: `/events/${eventId}` } })) > 0;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
    member = await login(app, 'kazhdyi@alliance.local');
    candidate = await loginNewCandidate(app, prisma, 'audience');
    boardToken = await login(app, 'sask@alliance.local');
    boardId = (await prisma.workingGroup.findFirstOrThrow({ where: { isBoard: true } })).id;
    await prisma.workingGroupMember.create({ data: { workingGroupId: boardId, userId: await userId(boardToken) } });
  });
  afterAll(() => app.close());

  it('всем членам: приходит членам, но не кандидатам', async () => {
    const e = await event({});
    expect(e.audience).toBe('ALL_MEMBERS');
    expect(await got(member, e.id)).toBe(true);
    expect(await got(candidate, e.id)).toBe(false);
  });

  it('только правлению: приходит только правлению, мероприятие привязано к разделу', async () => {
    const e = await event({ audience: 'BOARD' });
    expect(e.workingGroupId).toBe(boardId);
    expect(await got(boardToken, e.id)).toBe(true);
    expect(await got(member, e.id)).toBe(false);
    await http().get(`/api/events/${e.id}`).set(auth(member)).expect(404);
    await http().get(`/api/events/${e.id}`).set(auth(candidate)).expect(404);
  });

  it('заседание из раздела правления автоматически только для правления', async () => {
    const e = await event({ type: 'WORKING_GROUP_MEETING', workingGroupId: boardId });
    expect(e.audience).toBe('BOARD');
  });

  it('кандидатам: приходит кандидатам, не членам; кандидат видит и отвечает', async () => {
    const e = await event({ audience: 'CANDIDATES' });
    expect(await got(candidate, e.id)).toBe(true);
    expect(await got(member, e.id)).toBe(false);
    await http().get(`/api/events/${e.id}`).set(auth(candidate)).expect(200);
    await http().get(`/api/events/${e.id}`).set(auth(member)).expect(404);
    const list = await http().get('/api/events?pageSize=200').set(auth(candidate)).expect(200);
    expect(list.body.items.every((x: { audience: string }) => x.audience === 'CANDIDATES')).toBe(true);
  });
});

describe('Внесение правления', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
  });
  afterAll(() => app.close());

  it('создаёт учётку и приглашение только тем, кто есть на листе', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'board-'));
    writeFileSync(join(dir, 'board.csv'), 'Правление,,,\nОрганизация ,Регион ,ФИО ,Электронная почта\nОрг,Москва,Петрова Анна Ивановна (эксперт),petrova.board@alliance.local\n');
    const org = await prisma.organization.create({
      data: {
        name: 'Орг для правления',
        status: 'MEMBER',
        regionCode: 'RU-MOW',
        employees: { create: [{ fullName: 'Анна Петрова', allianceTags: ['BOARD'] }, { fullName: 'Иван Лишний', allianceTags: ['BOARD'] }] },
      },
    });
    const r = await setupBoard(prisma, dir);
    expect(r.members).toEqual(['Анна Петрова']);
    expect(r.invites).toHaveLength(1);
    expect(r.issues.join()).toContain('Иван Лишний');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'petrova.board@alliance.local' } });
    expect(user).toMatchObject({ status: 'INVITED', systemRole: 'USER', organizationId: org.id });
    expect(await prisma.workingGroupMember.count({ where: { userId: user.id, workingGroup: { isBoard: true } } })).toBe(1);
    expect((await setupBoard(prisma, dir)).invites).toHaveLength(0);
  });
});

describe('Назначение администратора', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
  });
  afterAll(() => app.close());

  it('создаёт администратора с приглашением, привязывает организацию и сотрудника', async () => {
    const org = await prisma.organization.create({ data: { name: 'РООРДИ "Проверка назначения"', status: 'MEMBER', regionCode: 'RU-KIR', employees: { create: { fullName: 'Иванов Иван Иванович' } } } });
    const r = await makeAdmin(prisma, { email: 'New.Admin@alliance.local', fullName: 'Иванов Иван Иванович', organization: 'Проверка назначения' });
    expect(r.inviteLink).toContain('/invite?token=');
    expect(r.linkedEmployee).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new.admin@alliance.local' } });
    expect(user).toMatchObject({ systemRole: 'ADMIN', status: 'INVITED', organizationId: org.id });
    expect((await prisma.employee.findFirstOrThrow({ where: { organizationId: org.id } })).userId).toBe(user.id);
    await expect(makeAdmin(prisma, { email: 'x@alliance.local', fullName: 'Икс', organization: 'нет такой организации' })).rejects.toThrow('найдено: 0');
    await prisma.user.update({ where: { id: user.id }, data: { systemRole: 'USER', status: 'BLOCKED' } });
  });
});

describe('Удаление демо-данных', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
  });
  afterAll(() => app.close());

  it('убирает организации и людей, голосование и администратор остаются', async () => {
    const org = await prisma.organization.create({ data: { name: 'Демо для удаления', status: 'MEMBER', regionCode: 'RU-MOW', isDemo: true } });
    const person = await prisma.user.create({ data: { email: 'demo-person@alliance.local', fullName: 'Демо Человек', isDemo: true, status: 'ACTIVE', passwordHash: 'x', organizationId: org.id } });
    const admin = await prisma.user.create({ data: { email: 'keep-admin@alliance.local', fullName: 'Администратор', isDemo: true, status: 'ACTIVE', systemRole: 'ADMIN', passwordHash: 'x' } });
    const vote = await prisma.vote.create({
      data: { title: 'Демо-голосование', scenario: 'OTHER', endsAt: new Date(), quorumPercent: 50, eligibility: 'ALL_MEMBERS', createdById: person.id, isDemo: true, eligibleVoters: { create: { organizationId: org.id } } },
    });
    await prisma.auditLog.create({ data: { actorUserId: person.id, action: 'test.demo', entityType: 'Test', entityId: 'x' } });

    const result = await removeDemo(prisma, 'keep-admin@alliance.local');

    expect(result).toMatchObject({ organizations: 1, users: 1 });
    expect(result.adminPassword).toBeTruthy();
    expect(await prisma.organization.findUnique({ where: { id: org.id } })).toBeNull();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({ fullName: 'Удалённая демо-учётка', status: 'BLOCKED', passwordHash: null, organizationId: null });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({ isDemo: false, status: 'ACTIVE' });
    expect(await prisma.vote.findUnique({ where: { id: vote.id } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { actorUserId: person.id } })).toBe(1);

    await prisma.vote.delete({ where: { id: vote.id } });
    await prisma.user.update({ where: { id: admin.id }, data: { systemRole: 'USER', status: 'BLOCKED' } });
  });
});

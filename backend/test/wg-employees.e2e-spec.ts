import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { linkWgLeaders } from '../prisma/link-wg-leaders';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginAdminWith2fa, loginSecretary } from './helpers';

interface Candidate {
  id: string;
  kind: string;
  account: string | null;
}

describe('Участники рабочих групп из сотрудников (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lead: string;
  let admin: string;
  let groupId: string;
  let orgId: string;
  const http = () => request(app.getHttpServer());
  const candidates = async () => (await http().get(`/api/working-groups/${groupId}/candidates`).set(auth(lead)).expect(200)).body as Candidate[];
  const group = async () => (await http().get(`/api/working-groups/${groupId}`).set(auth(lead)).expect(200)).body;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    lead = await login(app, 'opora@alliance.local');
    admin = await loginAdminWith2fa(app, prisma);
    const opora = await prisma.user.findUniqueOrThrow({ where: { email: 'opora@alliance.local' } });
    groupId = (await prisma.workingGroup.create({ data: { name: 'Группа для сотрудников', members: { create: { userId: opora.id, role: 'LEAD' } } } })).id;
    orgId = (await prisma.organization.create({ data: { name: 'Член для групп', status: 'MEMBER', regionCode: 'RU-MOW' } })).id;
  });
  afterAll(async () => {
    // Другие наборы тестов считают группы, которыми руководит opora
    await prisma.workingGroup.delete({ where: { id: groupId } });
    await app.close();
  });

  it('сотрудник без учётки: добавление, роль руководителя, переход на учётку', async () => {
    const e = await prisma.employee.create({ data: { organizationId: orgId, fullName: 'Без Учётки Иванович' } });
    expect((await candidates()).find((c) => c.id === e.id)).toMatchObject({ kind: 'employee', account: null });

    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ employeeId: e.id, role: 'LEAD' }).expect(403);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ employeeId: e.id }).expect(201);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ employeeId: e.id }).expect(409);
    expect((await group()).employeeMembers[0]).toMatchObject({ employeeId: e.id, fullName: 'Без Учётки Иванович', role: 'MEMBER' });
    expect((await candidates()).some((c) => c.id === e.id)).toBe(false);

    await http().patch(`/api/working-groups/${groupId}/employee-members/${e.id}`).set(auth(lead)).send({ role: 'LEAD' }).expect(403);
    await http().patch(`/api/working-groups/${groupId}/employee-members/${e.id}`).set(auth(admin)).send({ role: 'LEAD' }).expect(200);
    const list = await http().get('/api/working-groups').set(auth(lead)).expect(200);
    const item = list.body.find((g: { id: string }) => g.id === groupId);
    expect(item.leads.map((l: { fullName: string }) => l.fullName)).toContain('Без Учётки Иванович');
    expect(item.membersCount).toBe(2);

    const user = await prisma.user.create({ data: { email: 'wg.employee@alliance.local', fullName: 'Без Учётки Иванович', organizationId: orgId, status: 'INVITED' } });
    await prisma.employee.update({ where: { id: e.id }, data: { userId: user.id } });
    const after = await group();
    expect(after.employeeMembers).toHaveLength(0);
    expect(after.members.find((m: { userId: string }) => m.userId === user.id)).toMatchObject({ role: 'LEAD', account: 'INVITED' });
  });

  it('партнёр видит только свои группы, их заседания и протоколы; вступить сам не может', async () => {
    const partner = await login(app, 'izdat@alliance.local');
    const other = (await prisma.workingGroup.findFirstOrThrow({ where: { name: { startsWith: 'РГ по стандартам' } } })).id;
    expect((await http().get('/api/working-groups').set(auth(partner)).expect(200)).body).toHaveLength(0);
    await http().get(`/api/working-groups/${groupId}`).set(auth(partner)).expect(404);
    await http().post(`/api/working-groups/${groupId}/join`).set(auth(partner)).expect(404);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'izdat@alliance.local' } });
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ userId: user.id }).expect(201);
    await http().patch(`/api/working-groups/${groupId}/members/${user.id}`).set(auth(admin)).send({ role: 'LEAD' }).expect(200);
    const list = (await http().get('/api/working-groups').set(auth(partner)).expect(200)).body as { id: string }[];
    expect(list.map((g) => g.id)).toEqual([groupId]);
    expect((await http().get(`/api/working-groups/${groupId}`).set(auth(partner)).expect(200)).body).toMatchObject({ myRole: 'LEAD', canManage: true });
    await http().get(`/api/working-groups/${other}`).set(auth(partner)).expect(404);

    const secretary = await loginSecretary(app);
    const event = await http().post('/api/events').set(auth(secretary)).send({ title: 'Заседание с партнёром', type: 'WORKING_GROUP_MEETING', format: 'ONLINE', workingGroupId: groupId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), notify: false }).expect(201);
    await http().get(`/api/events/${event.body.id}`).set(auth(partner)).expect(200);
    const author = await prisma.user.findUniqueOrThrow({ where: { email: 'secretary@alliance.local' } });
    const protocol = await prisma.protocol.create({ data: { title: 'Протокол группы', status: 'PUBLISHED', heldAt: new Date(), authorId: author.id, workingGroupId: groupId } });
    await http().get(`/api/protocols/${protocol.id}`).set(auth(partner)).expect(200);

    await prisma.protocol.delete({ where: { id: protocol.id } });
    await http().delete(`/api/working-groups/${groupId}/members/${user.id}`).set(auth(admin)).expect(204);
  });

  it('созданный, но не вошедший пользователь добавляется без уведомления', async () => {
    const user = await prisma.user.create({ data: { email: 'wg.invited@alliance.local', fullName: 'Создан Не Вошёл', organizationId: orgId, status: 'INVITED' } });
    expect((await candidates()).find((c) => c.id === user.id)).toMatchObject({ kind: 'user', account: 'INVITED' });
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ userId: user.id }).expect(201);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('руководители из текста: несколько на группу, неопознанные остаются текстом', async () => {
    const withUser = await prisma.user.create({ data: { email: 'wg.lead.user@alliance.local', fullName: 'Шестакова Ксения Ильинична', organizationId: orgId, status: 'INVITED' } });
    await prisma.employee.create({ data: { organizationId: orgId, fullName: 'Шестакова Ксения Ильинична', userId: withUser.id } });
    const noUser = await prisma.employee.create({ data: { organizationId: orgId, fullName: 'Сидоров Пётр Львович' } });
    await prisma.organization.create({ data: { name: 'Партнёр лидера', status: 'PARTNER', regionCode: 'RU-MOW', employees: { create: { fullName: 'Партнёрова Вера' } } } });
    const g = await prisma.workingGroup.create({ data: { name: 'Группа с текстом', leaderNames: 'Ксения Шестакова (Орг «А») + Петр Сидоров + Вера Партнёрова (Партнёр) + Некто Неизвестный' } });

    const dry = await linkWgLeaders(prisma, false);
    expect(dry.linked).toHaveLength(3);
    expect(await prisma.workingGroupMember.count({ where: { workingGroupId: g.id } })).toBe(0);

    await linkWgLeaders(prisma, true);
    expect(await prisma.workingGroupMember.findFirst({ where: { workingGroupId: g.id, userId: withUser.id } })).toMatchObject({ role: 'LEAD' });
    expect(await prisma.workingGroupEmployee.findFirst({ where: { workingGroupId: g.id, employeeId: noUser.id } })).toMatchObject({ role: 'LEAD' });
    expect((await prisma.workingGroup.findUniqueOrThrow({ where: { id: g.id } })).leaderNames).toBe('Некто Неизвестный');
    await linkWgLeaders(prisma, true);
    expect(await prisma.workingGroupMember.count({ where: { workingGroupId: g.id } })).toBe(1);
    await prisma.workingGroup.delete({ where: { id: g.id } });
  });

  it('только сотрудники членов и партнёров; нужен один идентификатор; удаление', async () => {
    const partner = await prisma.organization.create({ data: { name: 'Партнёр для групп', status: 'PARTNER', regionCode: 'RU-MOW', employees: { create: { fullName: 'Сотрудник Партнёра' } } }, include: { employees: true } });
    expect((await candidates()).some((c) => c.id === partner.employees[0]!.id)).toBe(true);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ employeeId: partner.employees[0]!.id }).expect(201);
    const cand = await prisma.organization.create({ data: { name: 'Кандидат для групп', status: 'CANDIDATE', regionCode: 'RU-MOW', employees: { create: { fullName: 'Сотрудник Кандидата' } } }, include: { employees: true } });
    expect((await candidates()).some((c) => c.id === cand.employees[0]!.id)).toBe(false);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ employeeId: cand.employees[0]!.id }).expect(400);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({}).expect(400);
    const e = await prisma.employee.create({ data: { organizationId: orgId, fullName: 'На Удаление' } });
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ employeeId: e.id }).expect(201);
    await http().delete(`/api/working-groups/${groupId}/employee-members/${e.id}`).set(auth(lead)).expect(204);
    expect((await group()).employeeMembers.some((m: { employeeId: string }) => m.employeeId === e.id)).toBe(false);
  });
});

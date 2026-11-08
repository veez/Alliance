import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createUsers } from '../prisma/create-users';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginSecretary } from './helpers';

describe('Приглашения от секретаря (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let secretary: string;
  let member: string;
  let orgId: string;
  const http = () => request(app.getHttpServer());
  const employee = (fullName: string, email?: string) => prisma.employee.create({ data: { organizationId: orgId, fullName, email } });
  const invite = (id: string, token = secretary) => http().post(`/api/organizations/${orgId}/employees/${id}/invite`).set(auth(token));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
    member = await login(app, 'opora@alliance.local');
    orgId = (await prisma.organization.create({ data: { name: 'Орг для приглашений', status: 'MEMBER', regionCode: 'RU-MOW' } })).id;
  });
  afterAll(() => app.close());

  it('секретарь получает ссылку для сотрудника, учётка привязана, роль обычная', async () => {
    const e = await employee('Сотрудник Первый', 'First.Invite@alliance.local');
    const res = await invite(e.id).expect(200);
    expect(res.body.inviteLink).toContain('/invite?token=');
    expect(res.body.emailSent).toBe(false);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'first.invite@alliance.local' } });
    expect(user).toMatchObject({ systemRole: 'USER', status: 'INVITED', organizationId: orgId });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).userId).toBe(user.id);
  });

  it('ссылка стабильна при копировании, заменяется явно, после принятия статус активен', async () => {
    const e = await employee('Сотрудник Второй', 'second.invite@alliance.local');
    const first = await invite(e.id).expect(200);
    const again = await invite(e.id).expect(200);
    expect(again.body.inviteLink).toBe(first.body.inviteLink);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'second.invite@alliance.local' } });
    const copied = await http().post(`/api/admin/users/${user.id}/invite-link`).set(auth(secretary)).expect(200);
    expect(copied.body.inviteLink).toBe(first.body.inviteLink);
    const replaced = await http().post(`/api/admin/users/${user.id}/resend-invite`).set(auth(secretary)).expect(200);
    expect(replaced.body.inviteLink).not.toBe(first.body.inviteLink);
    const accept = (link: string) => http().post('/api/auth/invitations/accept').send({ token: new URL(link).searchParams.get('token'), password: 'Новый-пароль-123' });
    expect((await accept(first.body.inviteLink)).status).toBeGreaterThanOrEqual(400);
    expect((await accept(replaced.body.inviteLink)).status).toBeLessThan(300);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: 'ACTIVE' });
    expect((await prisma.invitation.findMany({ where: { userId: user.id, tokenEnc: { not: null } } })).length).toBe(0);
    await http().post(`/api/admin/users/${user.id}/invite-link`).set(auth(secretary)).expect(400);
  });

  it('истёкшая ссылка заменяется новой', async () => {
    const e = await employee('Сотрудник Третий', 'third.invite@alliance.local');
    const first = await invite(e.id).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'third.invite@alliance.local' } });
    await prisma.invitation.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const next = await invite(e.id).expect(200);
    expect(next.body.inviteLink).not.toBe(first.body.inviteLink);
  });

  it('массовое создание: статус «Создан», без приглашений, отказы и дубли пропускаются', async () => {
    const rejected = await prisma.organization.create({ data: { name: 'Отказ для учёток', status: 'REJECTED', employees: { create: { fullName: 'Из Отказа', email: 'rejected.bulk@alliance.local' } } } });
    await employee('Массовый Один', 'Bulk.One@alliance.local');
    await employee('Массовый Дубль', 'bulk.one@alliance.local');
    const dry = await createUsers(prisma, false);
    expect(await prisma.user.count({ where: { email: 'bulk.one@alliance.local' } })).toBe(0);
    const r = await createUsers(prisma, true);
    expect(r.created).toBe(dry.created);
    expect(r.issues.join()).toContain('Массовый Дубль');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'bulk.one@alliance.local' } });
    expect(user).toMatchObject({ status: 'INVITED', systemRole: 'USER', organizationId: orgId, passwordHash: null });
    expect(await prisma.invitation.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.user.count({ where: { email: 'rejected.bulk@alliance.local' } })).toBe(0);
    expect((await createUsers(prisma, true)).created).toBe(0);
    await prisma.organization.delete({ where: { id: rejected.id } });
  });

  it('ошибки: нет почты, почта занята, принявшему приглашать нельзя', async () => {
    await invite((await employee('Без Почты')).id).expect(400);
    await invite((await employee('Чужая Почта', 'kazhdyi@alliance.local')).id).expect(409);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'opora@alliance.local' } });
    const e = await prisma.employee.create({ data: { organizationId: orgId, fullName: 'Принявший', email: user.email, userId: user.id } });
    await invite(e.id).expect(409);
  });

  it('рядовой член Альянса приглашать не может', async () => {
    const e = await employee('Не Для Члена', 'nomember@alliance.local');
    await invite(e.id, member).expect(403);
    await http().post('/api/admin/users/invite').set(auth(member)).send({ email: 'x1@alliance.local', fullName: 'Икс', organizationId: orgId }).expect(403);
  });

  it('секретарь приглашает только обычных пользователей и не управляет учётками', async () => {
    await http().get('/api/admin/users').set(auth(secretary)).expect(200);
    await http().post('/api/admin/users/invite').set(auth(secretary)).send({ email: 'by.secretary@alliance.local', fullName: 'Новый Человек', organizationId: orgId }).expect(201);
    await http().post('/api/admin/users/invite').set(auth(secretary)).send({ email: 'evil.admin@alliance.local', fullName: 'Захват', systemRole: 'ADMIN' }).expect(403);
    const invitedAdmin = await prisma.user.create({ data: { email: 'invited.admin@alliance.local', fullName: 'Приглашённый Админ', systemRole: 'ADMIN', status: 'INVITED' } });
    await http().post(`/api/admin/users/${invitedAdmin.id}/resend-invite`).set(auth(secretary)).expect(403);
    await http().patch(`/api/admin/users/${invitedAdmin.id}`).set(auth(secretary)).send({ status: 'BLOCKED' }).expect(403);
    await prisma.user.update({ where: { id: invitedAdmin.id }, data: { systemRole: 'USER', status: 'BLOCKED' } });
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
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

  it('повторная ссылка заменяет прежнюю', async () => {
    const e = await employee('Сотрудник Второй', 'second.invite@alliance.local');
    const first = await invite(e.id).expect(200);
    const second = await invite(e.id).expect(200);
    expect(second.body.inviteLink).not.toBe(first.body.inviteLink);
    const token = new URL(first.body.inviteLink).searchParams.get('token');
    const accept = (t: string | null) => http().post('/api/auth/invitations/accept').send({ token: t, password: 'Новый-пароль-123' });
    expect((await accept(token)).status).toBeGreaterThanOrEqual(400);
    const fresh = await accept(new URL(second.body.inviteLink).searchParams.get('token'));
    expect(fresh.status).toBeLessThan(300);
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

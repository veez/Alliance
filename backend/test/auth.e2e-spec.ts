import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, DEMO_PASSWORD, login, loginAdminWith2fa, loginSecretary, refreshCookie } from './helpers';

describe('Аутентификация и 2FA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => ({ app, prisma } = await createApp()));
  afterAll(() => app.close());

  it('неверный пароль → 401 с общим сообщением', async () => {
    const res = await http().post('/api/auth/login').send({ email: 'opora@alliance.local', password: 'wrong-password' }).expect(401);
    expect(res.body.message).toBe('Неверный email или пароль');
    await http().post('/api/auth/login').send({ email: 'nobody@alliance.local', password: 'wrong-password' }).expect(401);
  });

  it('член Альянса входит без 2FA и получает свои права', async () => {
    const token = await login(app, 'opora@alliance.local');
    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    expect(me.body.organization.status).toBe('MEMBER');
    expect(me.body.permissions).toContain('vote.cast');
    expect(me.body.permissions).not.toContain('users.manage');
    expect(me.body.ledWorkingGroupIds).toHaveLength(1);
  });

  it('без токена → 401, с битым токеном → 401', async () => {
    await http().get('/api/auth/me').expect(401);
    await http().get('/api/auth/me').set(auth('garbage')).expect(401);
  });

  it('администратор без 2FA: доступ только к настройке 2FA, после включения — полный', async () => {
    // Исходное состояние: 2FA не настроена (другие наборы тестов могли её включить)
    await prisma.user.update({ where: { email: 'admin@alliance.local' }, data: { totpEnabledAt: null, totpSecretEnc: null } });
    const token = await login(app, 'admin@alliance.local');
    const blocked = await http().get('/api/admin/users').set(auth(token)).expect(403);
    expect(blocked.body.code).toBe('MFA_SETUP_REQUIRED');

    const me = await http().get('/api/auth/me').set(auth(token)).expect(200);
    expect(me.body.mfaSetupPending).toBe(true);
    expect(me.body.permissions).toEqual([]);

    const setup = await http().post('/api/auth/2fa/setup').set(auth(token)).expect(200);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    await http().post('/api/auth/2fa/enable').set(auth(token)).send({ code: '000000' }).expect(400);
    await http().post('/api/auth/2fa/enable').set(auth(token)).send({ code: authenticator.generate(setup.body.secret) }).expect(204);

    await http().get('/api/admin/users').set(auth(token)).expect(200);
    // Секрет в БД хранится зашифрованным
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@alliance.local' } });
    expect(u.totpSecretEnc).not.toContain(setup.body.secret);

    // Следующий вход требует код
    const step1 = await http().post('/api/auth/login').send({ email: 'admin@alliance.local', password: DEMO_PASSWORD }).expect(200);
    expect(step1.body.twoFactorRequired).toBe(true);
    expect(step1.body.accessToken).toBeUndefined();
    await http().post('/api/auth/login/2fa').send({ challengeToken: step1.body.challengeToken, code: '123456' }).expect(401);
    await http()
      .post('/api/auth/login/2fa')
      .send({ challengeToken: step1.body.challengeToken, code: authenticator.generate(setup.body.secret) })
      .expect(200);
  });

  it('секретарь: вход с кодом TOTP; аудит доступен, управление пользователями — нет', async () => {
    const token = await loginSecretary(app);
    await http().get('/api/admin/audit').set(auth(token)).expect(200);
    await http().get('/api/admin/users').set(auth(token)).expect(403);
  });

  it('секретарь не может отключить 2FA', async () => {
    const token = await loginSecretary(app);
    await http().post('/api/auth/2fa/disable').set(auth(token)).send({ code: '123456' }).expect(403);
  });

  it('refresh: требует X-CSRF, ротирует токен, повтор старого токена отзывает всю цепочку', async () => {
    const res = await http().post('/api/auth/login').send({ email: 'apk@alliance.local', password: DEMO_PASSWORD }).expect(200);
    const cookie1 = refreshCookie(res)!;
    expect(res.headers['set-cookie']![0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie']![0]).toMatch(/SameSite=Strict/);

    await http().post('/api/auth/refresh').set('Cookie', cookie1).expect(403);

    const r2 = await http().post('/api/auth/refresh').set('Cookie', cookie1).set('X-CSRF', '1').expect(200);
    const cookie2 = refreshCookie(r2)!;
    expect(cookie2).not.toEqual(cookie1);
    await http().get('/api/auth/me').set(auth(r2.body.accessToken)).expect(200);

    // Повторное использование старого refresh → отзыв цепочки, новый тоже перестаёт работать
    await http().post('/api/auth/refresh').set('Cookie', cookie1).set('X-CSRF', '1').expect(401);
    await http().post('/api/auth/refresh').set('Cookie', cookie2).set('X-CSRF', '1').expect(401);
    await http().get('/api/auth/me').set(auth(r2.body.accessToken)).expect(401);
  });

  it('выход завершает сессию: access-токен перестаёт работать', async () => {
    const res = await http().post('/api/auth/login').send({ email: 'ucmz@alliance.local', password: DEMO_PASSWORD }).expect(200);
    await http().post('/api/auth/logout').set('Cookie', refreshCookie(res)!).set('X-CSRF', '1').expect(204);
    await http().get('/api/auth/me').set(auth(res.body.accessToken)).expect(401);
  });

  it('блокировка после 5 неудачных попыток', async () => {
    for (let i = 0; i < 5; i++) {
      await http().post('/api/auth/login').send({ email: 'sask@alliance.local', password: 'wrong-password' }).expect(401);
    }
    await http().post('/api/auth/login').send({ email: 'sask@alliance.local', password: DEMO_PASSWORD }).expect(429);
    const entries = await prisma.auditLog.count({ where: { action: 'auth.locked' } });
    expect(entries).toBeGreaterThan(0);
    await prisma.user.update({ where: { email: 'sask@alliance.local' }, data: { lockedUntil: null } });
  });

  it('приглашение: админ приглашает, пользователь задаёт пароль и входит', async () => {
    const admin = await loginAdminWith2fa(app, prisma);
    const org = await prisma.organization.findFirstOrThrow({ where: { status: 'MEMBER' } });
    const inv = await http()
      .post('/api/admin/users/invite')
      .set(auth(admin))
      .send({ email: 'Invited.Person@Example.org', fullName: 'Приглашённый Пользователь', organizationId: org.id })
      .expect(201);
    expect(inv.body.user.email).toBe('invited.person@example.org');
    expect(inv.body.user.status).toBe('INVITED');
    const token = new URL(inv.body.inviteLink).searchParams.get('token')!;

    // Повторное приглашение на тот же email
    await http().post('/api/admin/users/invite').set(auth(admin)).send({ email: 'invited.person@example.org', fullName: 'Дубль' }).expect(409);

    // До принятия войти нельзя
    await http().post('/api/auth/login').send({ email: 'invited.person@example.org', password: 'anything-long' }).expect(401);

    const info = await http().get(`/api/auth/invitations/${token}`).expect(200);
    expect(info.body.organizationName).toBe(org.name);

    await http().post('/api/auth/invitations/accept').send({ token, password: 'short' }).expect(400);
    const accepted = await http().post('/api/auth/invitations/accept').send({ token, password: 'Новый-пароль-123' }).expect(200);
    expect(accepted.body.accessToken).toBeDefined();
    // Ссылка одноразовая
    await http().post('/api/auth/invitations/accept').send({ token, password: 'Новый-пароль-123' }).expect(400);
    await login(app, 'invited.person@example.org', 'Новый-пароль-123');
  });

  it('сброс пароля: ответ одинаковый для существующего и несуществующего email', async () => {
    await http().post('/api/auth/password/forgot').send({ email: 'nobody@alliance.local' }).expect(204);
    await http().post('/api/auth/password/forgot').send({ email: 'vmeste@alliance.local' }).expect(204);
    await http().post('/api/auth/password/reset').send({ token: 'invalid', password: 'Новый-пароль-123' }).expect(400);
  });

  it('заблокированный пользователь теряет доступ сразу', async () => {
    const admin = await loginAdminWith2fa(app, prisma);
    const memberToken = await login(app, 'belova@alliance.local');
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'belova@alliance.local' } });
    await http().patch(`/api/admin/users/${u.id}`).set(auth(admin)).send({ status: 'BLOCKED' }).expect(200);
    await http().get('/api/auth/me').set(auth(memberToken)).expect(401);
    await http().post('/api/auth/login').send({ email: 'belova@alliance.local', password: DEMO_PASSWORD }).expect(401);
    await http().patch(`/api/admin/users/${u.id}`).set(auth(admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('нельзя лишить прав последнего администратора', async () => {
    const admin = await loginAdminWith2fa(app, prisma);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@alliance.local' } });
    await http().patch(`/api/admin/users/${u.id}`).set(auth(admin)).send({ systemRole: 'USER' }).expect(400);
  });
});

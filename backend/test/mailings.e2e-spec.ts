import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { renderTemplate, DEFAULT_TEMPLATES } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginNewCandidate, loginSecretary } from './helpers';

describe('Рассылки по группам (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let secretary: string;
  let member: string;
  let boardToken: string;
  let candidate: string;
  const http = () => request(app.getHttpServer());
  const userId = async (token: string) => (await http().get('/api/auth/me').set(auth(token)).expect(200)).body.id as string;
  const got = async (token: string, title: string) => (await prisma.notification.count({ where: { userId: await userId(token), type: 'MAILING', title } })) > 0;
  const send = (audience: string, subject: string) => http().post('/api/mailings').set(auth(secretary)).send({ audience, subject, body: 'Текст сообщения' });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
    member = await login(app, 'kazhdyi@alliance.local');
    boardToken = await login(app, 'belova@alliance.local');
    candidate = await loginNewCandidate(app, prisma, 'mailing');
    const board = await prisma.workingGroup.findFirstOrThrow({ where: { isBoard: true } });
    await prisma.workingGroupMember.create({ data: { workingGroupId: board.id, userId: await userId(boardToken) } });
  });
  afterAll(() => app.close());

  it('только правлению', async () => {
    const res = await send('BOARD', 'Письмо правлению').expect(201);
    expect(res.body.recipients).toBeGreaterThan(0);
    expect(await got(boardToken, 'Письмо правлению')).toBe(true);
    expect(await got(member, 'Письмо правлению')).toBe(false);
    expect(await got(candidate, 'Письмо правлению')).toBe(false);
  });

  it('всем членам и кандидатам — по своим группам', async () => {
    await send('ALL_MEMBERS', 'Письмо членам').expect(201);
    expect(await got(member, 'Письмо членам')).toBe(true);
    expect(await got(candidate, 'Письмо членам')).toBe(false);
    await send('CANDIDATES', 'Письмо кандидатам').expect(201);
    expect(await got(candidate, 'Письмо кандидатам')).toBe(true);
    expect(await got(member, 'Письмо кандидатам')).toBe(false);
  });

  it('число получателей совпадает с отправкой, история и аудит записаны', async () => {
    const count = await http().get('/api/mailings/recipients?audience=ALL_MEMBERS').set(auth(secretary)).expect(200);
    const sent = await send('ALL_MEMBERS', 'Проверка числа').expect(201);
    expect(sent.body.recipients).toBe(count.body.count);
    const list = await http().get('/api/mailings').set(auth(secretary)).expect(200);
    expect(list.body.items[0]).toMatchObject({ subject: 'Проверка числа', createdBy: expect.objectContaining({ fullName: expect.any(String) }) });
    expect(await prisma.auditLog.count({ where: { action: 'mailing.sent', entityId: sent.body.id } })).toBe(1);
  });

  it('рядовой член и кандидат не могут рассылать и смотреть историю', async () => {
    await http().post('/api/mailings').set(auth(member)).send({ audience: 'BOARD', subject: 'Нельзя', body: 'x' }).expect(403);
    await http().get('/api/mailings').set(auth(boardToken)).expect(403);
    await http().get('/api/mailings/recipients?audience=BOARD').set(auth(candidate)).expect(403);
    await send('NOPE', 'Неверная группа').expect(400);
  });

  it('текст письма экранируется', () => {
    const html = renderTemplate(DEFAULT_TEMPLATES.MAILING!.bodyHtml, { fullName: 'Имя', body: '<script>alert(1)</script>', link: 'https://x' });
    expect(html).not.toContain('<script>');
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginAdminWith2fa, loginSecretary } from './helpers';

describe('Уведомления и настройки (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let member: string;
  let memberId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    member = await login(app, 'kazhdyi@alliance.local');
    memberId = (await prisma.user.findUniqueOrThrow({ where: { email: 'kazhdyi@alliance.local' } })).id;
  });
  afterAll(() => app.close());

  describe('уведомления', () => {
    it('лента, счётчик непрочитанных, отметка прочитанным — только своих', async () => {
      const notifications = app.get(NotificationsService);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      await notifications.notifyUsers([user], { type: 'WG_COMMENT', title: 'Тестовое уведомление', link: '/working-groups' });
      const count = await http().get('/api/notifications/unread-count').set(auth(member)).expect(200);
      expect(count.body.count).toBeGreaterThan(0);
      const list = await http().get('/api/notifications?unread=true').set(auth(member)).expect(200);
      const n = list.body.items.find((x: { title: string }) => x.title === 'Тестовое уведомление');
      expect(n).toBeTruthy();

      const other = await login(app, 'apk@alliance.local');
      await http().post(`/api/notifications/${n.id}/read`).set(auth(other)).expect(404);
      await http().post(`/api/notifications/${n.id}/read`).set(auth(member)).expect(204);
      const after = await http().get('/api/notifications/unread-count').set(auth(member)).expect(200);
      expect(after.body.count).toBe(count.body.count - 1);
      await http().post('/api/notifications/read-all').set(auth(member)).expect(200);
      expect((await http().get('/api/notifications/unread-count').set(auth(member))).body.count).toBe(0);
    });

    it('настройки: отключённые в портале уведомления не создаются', async () => {
      const prefs = await http().get('/api/notifications/preferences').set(auth(member)).expect(200);
      expect(prefs.body.find((p: { type: string }) => p.type === 'VOTE_STARTED')).toMatchObject({ inApp: true, email: true });
      await http().put('/api/notifications/preferences').set(auth(member)).send({ items: [{ type: 'UNKNOWN', inApp: true, email: true }] }).expect(400);
      await http().put('/api/notifications/preferences').set(auth(member)).send({ items: [{ type: 'WG_COMMENT', inApp: false, email: false }] }).expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
      const before = await prisma.notification.count({ where: { userId: memberId } });
      await app.get(NotificationsService).notifyUsers([user], { type: 'WG_COMMENT', title: 'Не должно прийти' });
      expect(await prisma.notification.count({ where: { userId: memberId } })).toBe(before);
      await http().put('/api/notifications/preferences').set(auth(member)).send({ items: [{ type: 'WG_COMMENT', inApp: true, email: true }] }).expect(200);
    });
  });

  describe('настройки портала (админ)', () => {
    let admin: string;
    beforeAll(async () => {
      admin = await loginAdminWith2fa(app, prisma);
    });

    it('только администратор; кворум по умолчанию применяется к новым голосованиям', async () => {
      await http().get('/api/admin/settings').set(auth(await loginSecretary(app))).expect(403);
      await http().get('/api/admin/settings').set(auth(member)).expect(403);
      const cur = await http().get('/api/admin/settings').set(auth(admin)).expect(200);
      await http().put('/api/admin/settings').set(auth(admin)).send({ ...cur.body, defaultQuorumPercent: 0 }).expect(400);
      const saved = await http()
        .put('/api/admin/settings')
        .set(auth(admin))
        .send({ defaultQuorumPercent: 66, voteReminderHours: [2, 24, 24], duesReminderDaysBefore: [7, 30] })
        .expect(200);
      expect(saved.body).toEqual({ defaultQuorumPercent: 66, voteReminderHours: [24, 2], duesReminderDaysBefore: [30, 7] });
      expect(await prisma.auditLog.count({ where: { action: 'settings.updated' } })).toBeGreaterThan(0);

      const secretary = await loginSecretary(app);
      const vote = await http()
        .post('/api/votes')
        .set(auth(secretary))
        .send({
          title: 'Проверка настроек по умолчанию',
          scenario: 'OTHER',
          eligibility: 'ALL_MEMBERS',
          endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
          questions: [{ text: 'Вопрос', format: 'YES_NO_ABSTAIN' }],
        })
        .expect(201);
      const v = await prisma.vote.findUniqueOrThrow({ where: { id: vote.body.id } });
      expect(v.quorumPercent).toBe(66);
      expect(v.reminders).toEqual([{ beforeHours: 24 }, { beforeHours: 2 }]);
      await http().put('/api/admin/settings').set(auth(admin)).send(cur.body).expect(200);
    });

    it('шаблоны писем: правка, предпросмотр с экранированием, сброс', async () => {
      const list = await http().get('/api/admin/email-templates').set(auth(admin)).expect(200);
      const tpl = list.body.find((t: { code: string }) => t.code === 'VOTE_STARTED');
      expect(tpl.variables).toEqual(expect.arrayContaining(['fullName', 'title', 'endsAt', 'link']));
      await http().put('/api/admin/email-templates/NOPE').set(auth(admin)).send({ subject: 'abc', bodyHtml: '<p>0123456789</p>' }).expect(404);

      const saved = await http()
        .put('/api/admin/email-templates/VOTE_STARTED')
        .set(auth(admin))
        .send({ subject: 'Голосуем: {{title}}', bodyHtml: '<p>Коллеги, {{fullName}}! До {{endsAt}}.</p>' })
        .expect(200);
      expect(saved.body).toMatchObject({ isDefault: false, updatedBy: { fullName: expect.any(String) } });

      const prev = await http().post('/api/admin/email-templates/VOTE_STARTED/preview').set(auth(admin)).send({ subject: 'Голосуем: {{title}}', bodyHtml: '<p>{{fullName}}</p>' }).expect(200);
      expect(prev.body.subject).toContain('Утверждение плана');
      expect(prev.body.html).toBe('<p>Иванова Мария Сергеевна</p>');

      const reset = await http().post('/api/admin/email-templates/VOTE_STARTED/reset').set(auth(admin)).expect(200);
      expect(reset.body.isDefault).toBe(true);
    });
  });
});

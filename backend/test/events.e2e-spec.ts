import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EventsService } from '../src/events/events.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginNewCandidate, loginSecretary } from './helpers';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('Мероприятия и протоколы (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let secretary: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
  });
  afterAll(() => app.close());

  const newEvent = (extra: Record<string, unknown> = {}) => ({
    title: 'Тестовая встреча',
    type: 'GENERAL_MEETING',
    format: 'HYBRID',
    location: 'Москва',
    onlineUrl: 'https://meet.example.org/x',
    startsAt: inDays(10),
    endsAt: inDays(10.1),
    notify: false,
    ...extra,
  });

  describe('мероприятия', () => {
    it('создают секретарь и админ; валидация места и сроков', async () => {
      await http().post('/api/events').set(auth(await login(app, 'opora@alliance.local'))).send(newEvent()).expect(403);
      await http().post('/api/events').set(auth(secretary)).send(newEvent({ location: null })).expect(400);
      await http().post('/api/events').set(auth(secretary)).send(newEvent({ endsAt: inDays(9) })).expect(400);
      await http().post('/api/events').set(auth(secretary)).send(newEvent({ registrationDeadline: inDays(11) })).expect(400);
      await http().post('/api/events').set(auth(secretary)).send(newEvent({ type: 'WORKING_GROUP_MEETING' })).expect(400);
      await http().post('/api/events').set(auth(secretary)).send(newEvent({ format: 'ONLINE', location: null })).expect(201);
    });

    it('приглашение рассылается всем пользователям организаций-членов', async () => {
      const before = await prisma.notification.count({ where: { type: 'EVENT_INVITE' } });
      await http().post('/api/events').set(auth(secretary)).send(newEvent({ notify: true })).expect(201);
      await new Promise((r) => setTimeout(r, 300));
      const memberUsers = await prisma.user.count({ where: { status: 'ACTIVE', organization: { status: 'MEMBER' } } });
      expect((await prisma.notification.count({ where: { type: 'EVENT_INVITE' } })) - before).toBe(memberUsers);
    });

    it('член подтверждает участие, может изменить ответ; формат проверяется', async () => {
      const e = (await http().post('/api/events').set(auth(secretary)).send(newEvent()).expect(201)).body;
      const token = await login(app, 'opora@alliance.local');
      await http().post(`/api/events/${e.id}/registration`).set(auth(token)).send({ registration: 'CONFIRMED_OFFLINE' }).expect(200);
      await http().post(`/api/events/${e.id}/registration`).set(auth(token)).send({ registration: 'DECLINED' }).expect(200);
      const view = await http().get(`/api/events/${e.id}`).set(auth(token)).expect(200);
      expect(view.body.my.registration).toBe('DECLINED');
      expect(view.body.summary.declined).toBe(1);

      const online = (await http().post('/api/events').set(auth(secretary)).send(newEvent({ format: 'ONLINE', location: null })).expect(201)).body;
      await http().post(`/api/events/${online.id}/registration`).set(auth(token)).send({ registration: 'CONFIRMED_OFFLINE' }).expect(400);
    });

    it('после дедлайна регистрация закрыта', async () => {
      const e = (await http().post('/api/events').set(auth(secretary)).send(newEvent()).expect(201)).body;
      await prisma.event.update({ where: { id: e.id }, data: { registrationDeadline: new Date(Date.now() - 1000) } });
      await http().post(`/api/events/${e.id}/registration`).set(auth(await login(app, 'opora@alliance.local'))).send({ registration: 'CONFIRMED_ONLINE' }).expect(409);
    });

    it('заседание РГ: регистрируются только участники группы, но видят все члены', async () => {
      const wg = await prisma.workingGroup.findFirstOrThrow({ where: { name: { startsWith: 'РГ по стандартам' } } });
      const e = (await http().post('/api/events').set(auth(secretary)).send(newEvent({ type: 'WORKING_GROUP_MEETING', workingGroupId: wg.id })).expect(201)).body;
      const outsider = await login(app, 'kazhdyi@alliance.local'); // не участник этой РГ
      const view = await http().get(`/api/events/${e.id}`).set(auth(outsider)).expect(200);
      expect(view.body.canRegister).toBe(false);
      await http().post(`/api/events/${e.id}/registration`).set(auth(outsider)).send({ registration: 'CONFIRMED_ONLINE' }).expect(403);
      await http().post(`/api/events/${e.id}/registration`).set(auth(await login(app, 'sask@alliance.local'))).send({ registration: 'CONFIRMED_ONLINE' }).expect(200);
      const managerView = await http().get(`/api/events/${e.id}`).set(auth(secretary)).expect(200);
      expect(managerView.body.summary.invitedOrganizations).toBe(3);
    });

    it('партнёр видит только открытые для партнёров мероприятия; кандидат — ничего', async () => {
      const closed = (await http().post('/api/events').set(auth(secretary)).send(newEvent()).expect(201)).body;
      const open = (await http().post('/api/events').set(auth(secretary)).send(newEvent({ visibleToPartners: true })).expect(201)).body;
      const partner = await login(app, 'izdat@alliance.local');
      await http().get(`/api/events/${closed.id}`).set(auth(partner)).expect(404);
      const view = await http().get(`/api/events/${open.id}`).set(auth(partner)).expect(200);
      expect(view.body.canRegister).toBe(true);
      await http().get(`/api/events/${open.id}`).set(auth(await loginNewCandidate(app, prisma, 'events'))).expect(404);
    });

    it('присутствие отмечается только после начала; первая отметка → «состоялось»', async () => {
      const e = (await http().post('/api/events').set(auth(secretary)).send(newEvent()).expect(201)).body;
      const opora = await prisma.user.findUniqueOrThrow({ where: { email: 'opora@alliance.local' } });
      await http().put(`/api/events/${e.id}/attendance`).set(auth(secretary)).send({ items: [{ userId: opora.id, presence: 'PRESENT_OFFLINE' }] }).expect(409);
      await prisma.event.update({ where: { id: e.id }, data: { startsAt: new Date(Date.now() - 3_600_000), endsAt: null } });
      const res = await http().put(`/api/events/${e.id}/attendance`).set(auth(secretary)).send({ items: [{ userId: opora.id, presence: 'PRESENT_OFFLINE' }] }).expect(200);
      expect(res.body.status).toBe('HELD');
      expect(res.body.summary.presentOrganizations).toBe(1);
      await http().put(`/api/events/${e.id}/attendance`).set(auth(await login(app, 'opora@alliance.local'))).send({ items: [] }).expect(403);
    });

    it('отмена уведомляет подтвердивших; ICS для календаря', async () => {
      const e = (await http().post('/api/events').set(auth(secretary)).send(newEvent({ title: 'Встреча, которую отменят' })).expect(201)).body;
      await http().post(`/api/events/${e.id}/registration`).set(auth(await login(app, 'apk@alliance.local'))).send({ registration: 'CONFIRMED_ONLINE' }).expect(200);
      const ics = await http().get(`/api/events/${e.id}/ics`).set(auth(secretary)).expect(200);
      expect(ics.text).toContain('BEGIN:VEVENT');
      expect(ics.text).toContain('SUMMARY:Встреча\\, которую отменят');
      await http().post(`/api/events/${e.id}/cancel`).set(auth(secretary)).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      const apk = await prisma.user.findUniqueOrThrow({ where: { email: 'apk@alliance.local' } });
      expect(await prisma.notification.count({ where: { userId: apk.id, type: 'EVENT_CANCELLED' } })).toBe(1);
      await http().post(`/api/events/${e.id}/registration`).set(auth(await login(app, 'apk@alliance.local'))).send({ registration: 'CONFIRMED_ONLINE' }).expect(409);
    });

    it('напоминание за сутки — подтвердившим и один раз', async () => {
      const e = (await http().post('/api/events').set(auth(secretary)).send(newEvent({ startsAt: inDays(0.5), endsAt: inDays(0.6) })).expect(201)).body;
      await http().post(`/api/events/${e.id}/registration`).set(auth(await login(app, 'ucmz@alliance.local'))).send({ registration: 'CONFIRMED_OFFLINE' }).expect(200);
      const service = app.get(EventsService);
      expect(await service.sendReminders()).toBeGreaterThanOrEqual(1);
      expect(await service.sendReminders()).toBe(0);
    });

    it('календарь: ближайшие и прошедшие', async () => {
      const token = await login(app, 'opora@alliance.local');
      const upcoming = await http().get('/api/events?scope=upcoming&pageSize=100').set(auth(token)).expect(200);
      expect(upcoming.body.items.every((e: { status: string }) => e.status !== 'CANCELLED')).toBe(true);
      const past = await http().get('/api/events?scope=past&pageSize=100').set(auth(token)).expect(200);
      expect(past.body.items.some((e: { status: string }) => e.status === 'HELD')).toBe(true);
    });

    it('статистика: рейтинг активности членов Альянса', async () => {
      const res = await http().get('/api/events/stats').set(auth(await login(app, 'opora@alliance.local'))).expect(200);
      expect(res.body.rating.length).toBe(await prisma.organization.count({ where: { status: 'MEMBER' } }));
      expect(res.body.totals.eventsHeld).toBeGreaterThan(0);
      const scores = res.body.rating.map((r: { score: number | null }) => r.score ?? -1);
      expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
      await http().get('/api/events/stats').set(auth(await login(app, 'izdat@alliance.local'))).expect(403);
    });
  });

  describe('протоколы', () => {
    const protocol = (extra: Record<string, unknown> = {}) => ({
      title: 'Протокол тестовой встречи',
      number: 'T-1',
      heldAt: new Date().toISOString(),
      items: [{ agendaText: 'Вопрос первый', discussion: 'Обсудили', decision: 'Решили' }],
      ...extra,
    });

    it('черновик видят только те, кто ведёт; после публикации — члены', async () => {
      const p = (await http().post('/api/protocols').set(auth(secretary)).send(protocol()).expect(201)).body;
      const member = await login(app, 'opora@alliance.local');
      await http().get(`/api/protocols/${p.id}`).set(auth(member)).expect(404);
      await http().post(`/api/protocols/${p.id}/publish`).set(auth(member)).expect(404);
      await http().post(`/api/protocols/${p.id}/publish`).set(auth(secretary)).expect(200);
      const view = await http().get(`/api/protocols/${p.id}`).set(auth(member)).expect(200);
      expect(view.body.items[0].decision).toBe('Решили');
      expect(view.body.canManage).toBe(false);
      // Опубликованный не редактируется
      await http().patch(`/api/protocols/${p.id}`).set(auth(secretary)).send(protocol({ title: 'Иначе' })).expect(409);
      await http().post(`/api/protocols/${p.id}/unpublish`).set(auth(secretary)).expect(200);
      await http().patch(`/api/protocols/${p.id}`).set(auth(secretary)).send(protocol({ title: 'Иначе' })).expect(200);
    });

    it('член Альянса не может создать общий протокол', async () => {
      await http().post('/api/protocols').set(auth(await login(app, 'kazhdyi@alliance.local'))).send(protocol()).expect(403);
    });

    it('руководитель РГ ведёт протоколы своей группы, но не чужой', async () => {
      const own = await prisma.workingGroup.findFirstOrThrow({ where: { name: { startsWith: 'РГ по стандартам' } } }); // opora — руководитель
      const other = await prisma.workingGroup.findFirstOrThrow({ where: { name: { startsWith: 'РГ по обучению' } } });
      const lead = await login(app, 'opora@alliance.local');
      const p = (await http().post('/api/protocols').set(auth(lead)).send(protocol({ workingGroupId: own.id })).expect(201)).body;
      await http().post(`/api/protocols/${p.id}/publish`).set(auth(lead)).expect(200);
      await http().post('/api/protocols').set(auth(lead)).send(protocol({ workingGroupId: other.id })).expect(403);
    });

    it('протокол мероприятия: присутствовавшие организации, связанное голосование, файлы, PDF', async () => {
      const event = await prisma.event.findFirstOrThrow({ where: { status: 'HELD', type: 'GENERAL_MEETING' } });
      const vote = await prisma.vote.findFirstOrThrow({ where: { status: 'CLOSED' } });
      const p = (
        await http()
          .post('/api/protocols')
          .set(auth(secretary))
          .send(protocol({ eventId: event.id, items: [{ agendaText: 'Итоги голосования', decision: 'Утвердить', voteId: vote.id }] }))
          .expect(201)
      ).body;
      const file = await http()
        .post(`/api/protocols/${p.id}/files`)
        .set(auth(secretary))
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'Презентация.pdf', contentType: 'application/pdf' })
        .expect(201);
      const view = await http().get(`/api/protocols/${p.id}`).set(auth(secretary)).expect(200);
      expect(view.body.attendance.present.length).toBeGreaterThan(0);
      expect(view.body.items[0].vote.outcome).toBeTruthy();
      expect(view.body.attachments[0].id).toBe(file.body.id);

      const pdf = await http()
        .get(`/api/protocols/${p.id}/pdf`)
        .set(auth(secretary))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      // Удалить можно только черновик
      await http().delete(`/api/protocols/${p.id}`).set(auth(secretary)).expect(204);
    });

    it('партнёр видит только опубликованные протоколы, отмеченные для партнёров', async () => {
      const hidden = (await http().post('/api/protocols').set(auth(secretary)).send(protocol()).expect(201)).body;
      const shown = (await http().post('/api/protocols').set(auth(secretary)).send(protocol({ visibleToPartners: true })).expect(201)).body;
      await http().post(`/api/protocols/${hidden.id}/publish`).set(auth(secretary)).expect(200);
      await http().post(`/api/protocols/${shown.id}/publish`).set(auth(secretary)).expect(200);
      const partner = await login(app, 'izdat@alliance.local');
      await http().get(`/api/protocols/${hidden.id}`).set(auth(partner)).expect(404);
      await http().get(`/api/protocols/${shown.id}`).set(auth(partner)).expect(200);
    });
  });
});

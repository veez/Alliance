import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mskYear } from '../src/common/time';
import { DuesService } from '../src/dues/dues.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginAdminWith2fa, loginSecretary } from './helpers';

describe('Взносы и договоры (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let secretary: string;
  const year = mskYear();

  const orgOf = (login: string) => prisma.organization.findFirstOrThrow({ where: { users: { some: { email: `${login}@alliance.local` } } } });
  const duesOf = async (login: string, y = year) => prisma.dues.findUniqueOrThrow({ where: { organizationId_year: { organizationId: (await orgOf(login)).id, year: y } } });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
    // Тесты привязаны к текущему году по Москве: гарантируем настройки и начисления
    await http().put(`/api/dues/settings/${year}`).set(auth(secretary)).send({ amount: 36000, dueDate: `${year}-12-31` }).expect(200);
    await http().post(`/api/dues/years/${year}/accrue`).set(auth(secretary)).expect(200);
  });
  afterAll(() => app.close());

  describe('доступ', () => {
    it('реестр — только секретарю, админу и «видящим всё»', async () => {
      await http().get(`/api/dues?year=${year}`).set(auth(await login(app, 'opora@alliance.local'))).expect(403);
      await http().get(`/api/dues?year=${year}`).set(auth(await login(app, 'apk@alliance.local'))).expect(200); // особые права
      const res = await http().get(`/api/dues?year=${year}&pageSize=100`).set(auth(secretary)).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.summary.totalDue).toBeGreaterThan(0);
    });

    it('член видит историю своей организации, но не чужой', async () => {
      const token = await login(app, 'opora@alliance.local');
      const own = await http().get(`/api/dues/organization/${(await orgOf('opora')).id}`).set(auth(token)).expect(200);
      expect(own.body.dues.map((d: { year: number }) => d.year)).toEqual(expect.arrayContaining([2025, 2026]));
      expect(own.body.agreements.length).toBeGreaterThan(0);
      await http().get(`/api/dues/organization/${(await orgOf('kazhdyi')).id}`).set(auth(token)).expect(404);
      const my = await http().get('/api/dues/my').set(auth(token)).expect(200);
      expect(my.body.year).toBe(year);
    });

    it('партнёр не видит взносы', async () => {
      const token = await login(app, 'izdat@alliance.local');
      await http().get(`/api/dues/organization/${(await orgOf('opora')).id}`).set(auth(token)).expect(404);
      await http().get('/api/agreements').set(auth(token)).expect(403);
    });

    it('член не может отмечать платежи и менять настройки', async () => {
      const token = await login(app, 'opora@alliance.local');
      const d = await duesOf('ucmz');
      await http().post(`/api/dues/${d.id}/payments`).set(auth(token)).send({ amount: 100, paidAt: '2026-01-01' }).expect(403);
      await http().put(`/api/dues/settings/${year}`).set(auth(token)).send({ amount: 1, dueDate: '2026-01-01' }).expect(403);
    });
  });

  describe('начисление и платежи', () => {
    it('начисление за год идемпотентно', async () => {
      await http().put('/api/dues/settings/2031').set(auth(secretary)).send({ amount: 40000, dueDate: '2031-03-31', graceDays: 10 }).expect(200);
      const first = await http().post('/api/dues/years/2031/accrue').set(auth(secretary)).expect(200);
      const members = await prisma.organization.count({ where: { status: 'MEMBER' } });
      expect(first.body.created).toBe(members);
      const second = await http().post('/api/dues/years/2031/accrue').set(auth(secretary)).expect(200);
      expect(second.body.created).toBe(0);
      await http().post('/api/dues/years/2032/accrue').set(auth(secretary)).expect(400);
    });

    it('частичная оплата → «частично», полная → «оплачен», удаление платежа → обратно', async () => {
      const d = await duesOf('ucmz', 2031);
      const p1 = await http().post(`/api/dues/${d.id}/payments`).set(auth(secretary)).send({ amount: 15000, paidAt: '2026-10-01', documentNumber: '555' }).expect(201);
      expect(p1.body.status).toBe('PARTIAL');
      const p2 = await http().post(`/api/dues/${d.id}/payments`).set(auth(secretary)).send({ amount: 25000, paidAt: '2026-10-05' }).expect(201);
      expect(p2.body.status).toBe('PAID');
      const card = await http().get(`/api/dues/${d.id}`).set(auth(secretary)).expect(200);
      expect(card.body).toMatchObject({ amountDue: 40000, paid: 40000, debt: 0 });
      await http().delete(`/api/dues/${d.id}/payments/${p2.body.payment.id}`).set(auth(secretary)).expect(204);
      expect((await prisma.dues.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('PARTIAL');
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'Dues', entityId: d.id } });
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['dues.payment_added', 'dues.payment_removed']));
    });

    it('платёж с датой в будущем отклоняется', async () => {
      const d = await duesOf('ucmz', 2031);
      await http().post(`/api/dues/${d.id}/payments`).set(auth(secretary)).send({ amount: 1, paidAt: '2099-01-01' }).expect(400);
    });

    it('освобождение и его отмена', async () => {
      const d = await duesOf('sask', 2031);
      const w = await http().patch(`/api/dues/${d.id}`).set(auth(secretary)).send({ waived: true, note: 'Решение правления' }).expect(200);
      expect(w.body.status).toBe('WAIVED');
      const u = await http().patch(`/api/dues/${d.id}`).set(auth(secretary)).send({ waived: false }).expect(200);
      expect(u.body.status).toBe('UNPAID');
    });

    it('после срока и льготных дней неоплаченные становятся просроченными', async () => {
      const service = app.get(DuesService);
      await service.recomputeOpen(new Date('2031-04-05T10:00:00Z')); // в пределах 10 льготных дней
      expect((await duesOf('kazhdyi', 2031)).status).toBe('UNPAID');
      await service.recomputeOpen(new Date('2031-04-15T10:00:00Z'));
      expect((await duesOf('kazhdyi', 2031)).status).toBe('OVERDUE');
      const reg = await http().get('/api/dues?year=2031&status=DEBT&pageSize=100').set(auth(secretary)).expect(200);
      expect(reg.body.items.every((i: { status: string }) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status))).toBe(true);
      expect(reg.body.summary.counts.OVERDUE).toBeGreaterThan(0);
    });

    it('изменение суммы за год применяется к начисленным (кроме освобождённых)', async () => {
      const d = await duesOf('vmeste', 2031);
      await http().patch(`/api/dues/${d.id}`).set(auth(secretary)).send({ waived: true }).expect(200);
      const res = await http().put('/api/dues/settings/2031').set(auth(secretary)).send({ amount: 42000, dueDate: '2031-03-31', graceDays: 10, applyToExisting: true }).expect(200);
      expect(res.body.appliedToExisting).toBeGreaterThan(0);
      expect(Number((await duesOf('opora', 2031)).amountDue)).toBe(42000);
      expect(Number((await duesOf('vmeste', 2031)).amountDue)).toBe(40000);
    });
  });

  describe('документы и договоры', () => {
    it('организация прикладывает платёжку к своему взносу; чужие не видят', async () => {
      const d = await duesOf('ucmz');
      const own = await login(app, 'ucmz@alliance.local');
      const up = await http()
        .post(`/api/dues/${d.id}/files`)
        .set(auth(own))
        .field('docType', 'PAYMENT_ORDER')
        .attach('file', Buffer.from('%PDF-1.4 demo'), { filename: 'Платёжка.pdf', contentType: 'application/pdf' })
        .expect(201);
      expect(up.body.docType).toBe('PAYMENT_ORDER');
      await http().get(`/api/dues/${d.id}/files/${up.body.id}`).set(auth(own)).expect(200);
      await http().get(`/api/dues/${d.id}/files/${up.body.id}`).set(auth(secretary)).expect(200);
      const other = await login(app, 'opora@alliance.local');
      await http().get(`/api/dues/${d.id}/files/${up.body.id}`).set(auth(other)).expect(404);
      await http()
        .post(`/api/dues/${d.id}/files`)
        .set(auth(other))
        .attach('file', Buffer.from('x'), { filename: 'x.pdf', contentType: 'application/pdf' })
        .expect(403);
      // Удалять документ может только секретарь/админ
      await http().delete(`/api/dues/${d.id}/files/${up.body.id}`).set(auth(own)).expect(403);
    });

    it('недопустимый тип файла отклоняется', async () => {
      const d = await duesOf('ucmz');
      await http()
        .post(`/api/dues/${d.id}/files`)
        .set(auth(secretary))
        .attach('file', Buffer.from('<script>'), { filename: 'evil.html', contentType: 'text/html' })
        .expect(400);
    });

    it('договор пожертвования: создание, файл, видимость для своей организации', async () => {
      const org = await orgOf('vmeste');
      const created = await http()
        .post('/api/agreements')
        .set(auth(secretary))
        .send({ organizationId: org.id, number: 'ДП-ТЕСТ/1', year, amount: 36000, status: 'SIGNED', signedAt: `${year}-02-01` })
        .expect(201);
      const file = await http()
        .post(`/api/agreements/${created.body.id}/files`)
        .set(auth(secretary))
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'Договор.pdf', contentType: 'application/pdf' })
        .expect(201);
      const list = await http().get(`/api/agreements?organizationId=${org.id}`).set(auth(secretary)).expect(200);
      expect(list.body.items[0].documents[0].originalName).toBe('Договор.pdf');
      await http().get(`/api/agreements/${created.body.id}/files/${file.body.id}`).set(auth(await login(app, 'vmeste@alliance.local'))).expect(200);
      await http().get(`/api/agreements/${created.body.id}/files/${file.body.id}`).set(auth(await login(app, 'opora@alliance.local'))).expect(404);
      await http().patch(`/api/agreements/${created.body.id}`).set(auth(secretary)).send({ status: 'TERMINATED' }).expect(200);
    });

    it('договоры: организация с особыми правами «видеть всё» видит только свои', async () => {
      const own = await orgOf('apk');
      const other = await orgOf('kazhdyi');
      const create = (organizationId: string, number: string) =>
        http().post('/api/agreements').set(auth(secretary)).send({ organizationId, number, year, amount: 1000, status: 'SIGNED', signedAt: `${year}-03-01` }).expect(201);
      const mine = await create(own.id, 'ДП-СВОЙ/1');
      const foreign = await create(other.id, 'ДП-ЧУЖОЙ/1');
      const file = await http()
        .post(`/api/agreements/${foreign.body.id}/files`)
        .set(auth(secretary))
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'Чужой.pdf', contentType: 'application/pdf' })
        .expect(201);

      const token = await login(app, 'apk@alliance.local');
      for (const url of ['/api/agreements?pageSize=100', `/api/agreements?organizationId=${other.id}&pageSize=100`]) {
        const list = await http().get(url).set(auth(token)).expect(200);
        expect(list.body.items.map((a: { id: string }) => a.id)).toContain(mine.body.id);
        expect(list.body.items.every((a: { organizationId: string }) => a.organizationId === own.id)).toBe(true);
      }
      const history = await http().get(`/api/dues/organization/${other.id}`).set(auth(token)).expect(200);
      expect(history.body).toMatchObject({ agreements: [], agreementsVisible: false });
      await http().get(`/api/agreements/${foreign.body.id}/files/${file.body.id}`).set(auth(token)).expect(404);
      const audit = await http().get('/api/admin/audit?entityType=Agreement').set(auth(token)).expect(200);
      expect(audit.body.total).toBe(0);

      const all = await http().get(`/api/agreements?organizationId=${other.id}`).set(auth(secretary)).expect(200);
      expect(all.body.items.map((a: { id: string }) => a.id)).toContain(foreign.body.id);
    });
  });

  describe('напоминания и связь с голосованиями', () => {
    it('ручная рассылка должникам — не чаще раза в день', async () => {
      const first = await http().post(`/api/dues/years/${year}/remind`).set(auth(secretary)).expect(200);
      expect(first.body.sent).toBeGreaterThan(0);
      const second = await http().post(`/api/dues/years/${year}/remind`).set(auth(secretary)).expect(200);
      expect(second.body.sent).toBe(0);
      const notes = await prisma.notification.count({ where: { type: 'DUES_REMINDER' } });
      expect(notes).toBeGreaterThan(0);
    });

    it('плановые напоминания: за 30 дней и после срока, без повторов', async () => {
      const service = app.get(DuesService);
      const at = new Date('2031-03-10T09:00:00Z');
      expect(await service.sendScheduledReminders(at)).toBeGreaterThan(0);
      const open2031 = await prisma.dues.count({ where: { year: 2031, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } } });
      expect(await prisma.duesReminderLog.count({ where: { kind: 'before_30d', dues: { year: 2031 } } })).toBe(open2031);
      // Повторный запуск в тот же момент ничего не отправляет
      expect(await service.sendScheduledReminders(at)).toBe(0);
      // После срока — новое напоминание о просрочке
      await service.recomputeOpen(new Date('2031-04-15T09:00:00Z'));
      await service.sendScheduledReminders(new Date('2031-04-15T09:00:00Z'));
      expect(await prisma.duesReminderLog.count({ where: { kind: 'overdue_0', dues: { year: 2031 } } })).toBeGreaterThan(0);
    });

    it('«голосуют только оплатившие»: в состав голосования попадают только организации с оплаченным взносом', async () => {
      await http().put(`/api/dues/settings/${year}`).set(auth(secretary)).send({ amount: 36000, dueDate: `${year}-12-31`, votingRequiresPaid: true }).expect(200);
      const created = await http()
        .post('/api/votes')
        .set(auth(secretary))
        .send({ title: 'Только оплатившие', scenario: 'OTHER', endsAt: new Date(Date.now() + 86_400_000).toISOString(), eligibility: 'ALL_MEMBERS', questions: [{ text: 'Вопрос?', format: 'YES_NO_ABSTAIN' }] })
        .expect(201);
      await http().post(`/api/votes/${created.body.id}/publish`).set(auth(secretary)).expect(200);
      const eligible = await prisma.voteEligibleVoter.findMany({ where: { voteId: created.body.id } });
      const paid = await prisma.dues.findMany({ where: { year, status: { in: ['PAID', 'WAIVED'] } } });
      expect(eligible.map((e) => e.organizationId).sort()).toEqual(paid.map((p) => p.organizationId).sort());
      await http().put(`/api/dues/settings/${year}`).set(auth(secretary)).send({ amount: 36000, dueDate: `${year}-12-31`, votingRequiresPaid: false }).expect(200);
    });

    it('новому члену Альянса взнос текущего года начисляется автоматически', async () => {
      const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: 'opora@alliance.local' } })).passwordHash;
      const cand = await prisma.organization.create({
        data: { name: 'Кандидат для теста взносов', regionCode: 'RU-OMS', status: 'CANDIDATE', users: { create: { email: 'dues-candidate@alliance.local', fullName: 'Тестов Т. Т.', status: 'ACTIVE', passwordHash } } },
      });
      const admin = await loginAdminWith2fa(app, prisma);
      await http().post(`/api/organizations/${cand.id}/status`).set(auth(admin)).send({ status: 'MEMBER' }).expect(201);
      const d = await prisma.dues.findUnique({ where: { organizationId_year: { organizationId: cand.id, year } } });
      expect(d).not.toBeNull();
      expect(Number(d!.amountDue)).toBe(36000);
    });
  });
});

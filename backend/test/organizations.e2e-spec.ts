import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginAdminWith2fa, loginSecretary } from './helpers';

describe('Организации, сотрудники, аудит (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let oporaId: string;
  let apkId: string;
  let candidateId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    oporaId = (await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'opora@alliance.local' } } } })).id;
    apkId = (await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'apk@alliance.local' } } } })).id;
    candidateId = (await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'teplydom@alliance.local' } } } })).id;
  });
  afterAll(() => app.close());

  describe('видимость полей', () => {
    it('член видит контакты других организаций, но не их реквизиты', async () => {
      const token = await login(app, 'kazhdyi@alliance.local');
      const res = await http().get(`/api/organizations/${oporaId}`).set(auth(token)).expect(200);
      expect(res.body.fullAccess).toBe(false);
      expect(res.body.email).toBeDefined();
      expect(res.body.headName).toBeDefined();
      expect(res.body.inn).toBeUndefined();
      expect(res.body.legalAddress).toBeUndefined();
    });

    it('кандидат не видит контакты членов', async () => {
      const token = await login(app, 'teplydom@alliance.local');
      const res = await http().get(`/api/organizations/${oporaId}`).set(auth(token)).expect(200);
      expect(res.body.email).toBeUndefined();
      expect(res.body.phone).toBeUndefined();
      expect(res.body.name).toBeDefined();
    });

    it('своя организация и «видящий всё» получают полную карточку', async () => {
      const own = await http().get(`/api/organizations/${oporaId}`).set(auth(await login(app, 'opora@alliance.local'))).expect(200);
      expect(own.body.fullAccess).toBe(true);
      expect(own.body.inn).toBeDefined();
      // apk@ — член с особыми правами «видеть всё»
      const viewAll = await http().get(`/api/organizations/${oporaId}`).set(auth(await login(app, 'apk@alliance.local'))).expect(200);
      expect(viewAll.body.fullAccess).toBe(true);
    });

    it('обычные участники не видят вышедшие из Альянса организации', async () => {
      const admin = await loginAdminWith2fa(app, prisma);
      const created = await http()
        .post('/api/organizations')
        .set(auth(admin))
        .send({ name: 'Вышедшая организация', regionCode: 'RU-OMS', status: 'EXITED' })
        .expect(201);
      const member = await login(app, 'kazhdyi@alliance.local');
      await http().get(`/api/organizations/${created.body.id}`).set(auth(member)).expect(404);
      const list = await http().get('/api/organizations?pageSize=200').set(auth(member)).expect(200);
      expect(list.body.items.find((o: { id: string }) => o.id === created.body.id)).toBeUndefined();
      const adminList = await http().get('/api/organizations?pageSize=200&status=EXITED').set(auth(admin)).expect(200);
      expect(adminList.body.items.map((o: { id: string }) => o.id)).toContain(created.body.id);
    });
  });

  describe('редактирование', () => {
    it('член редактирует свою организацию, но не чужую', async () => {
      const token = await login(app, 'opora@alliance.local');
      const res = await http().patch(`/api/organizations/${oporaId}`).set(auth(token)).send({ city: 'Москва', website: 'https://opora.example' }).expect(200);
      expect(res.body.website).toBe('https://opora.example');
      await http().patch(`/api/organizations/${apkId}`).set(auth(token)).send({ city: 'Взлом' }).expect(403);
    });

    it('член не может сменить статус своей организации', async () => {
      const token = await login(app, 'opora@alliance.local');
      await http().patch(`/api/organizations/${oporaId}`).set(auth(token)).send({ status: 'PARTNER' }).expect(400);
      await http().post(`/api/organizations/${oporaId}/status`).set(auth(token)).send({ status: 'PARTNER' }).expect(403);
    });

    it('валидация реквизитов', async () => {
      const token = await login(app, 'opora@alliance.local');
      const res = await http().patch(`/api/organizations/${oporaId}`).set(auth(token)).send({ inn: '123' }).expect(400);
      expect(JSON.stringify(res.body.message)).toContain('ИНН');
      await http().patch(`/api/organizations/${oporaId}`).set(auth(token)).send({ regionCode: 'RU-XXX' }).expect(400);
    });

    it('секретарь видит всё, но не меняет статусы и чужие профили', async () => {
      const token = await loginSecretary(app);
      await http().get(`/api/organizations/${apkId}/status-history`).set(auth(token)).expect(200);
      await http().post(`/api/organizations/${candidateId}/status`).set(auth(token)).send({ status: 'MEMBER' }).expect(403);
      await http().patch(`/api/organizations/${apkId}`).set(auth(token)).send({ city: 'X' }).expect(403);
    });
  });

  describe('смена статуса кандидат → член', () => {
    it('админ принимает кандидата: история, права пользователя, аудит', async () => {
      const candidateToken = await login(app, 'teplydom@alliance.local');
      const before = await http().get('/api/auth/me').set(auth(candidateToken)).expect(200);
      expect(before.body.permissions).not.toContain('vote.cast');

      const admin = await loginAdminWith2fa(app, prisma);
      const res = await http()
        .post(`/api/organizations/${candidateId}/status`)
        .set(auth(admin))
        .send({ status: 'MEMBER', reason: 'Решение общего собрания, протокол № 5' })
        .expect(201);
      expect(res.body.status).toBe('MEMBER');
      expect(res.body.joinedAt).not.toBeNull();

      const history = await http().get(`/api/organizations/${candidateId}/status-history`).set(auth(admin)).expect(200);
      expect(history.body[0]).toMatchObject({ fromStatus: 'CANDIDATE', toStatus: 'MEMBER', reason: 'Решение общего собрания, протокол № 5' });

      // Права меняются без перелогина
      const after = await http().get('/api/auth/me').set(auth(candidateToken)).expect(200);
      expect(after.body.permissions).toContain('vote.cast');

      const app2 = await prisma.candidateApplication.findUniqueOrThrow({ where: { organizationId: candidateId } });
      expect(app2.status).toBe('APPROVED');

      const audit = await http().get(`/api/admin/audit?entityType=Organization&entityId=${candidateId}`).set(auth(admin)).expect(200);
      expect(audit.body.items[0].action).toBe('organization.status_changed');
    });
  });

  describe('сотрудники', () => {
    it('член ведёт своих сотрудников с областями ответственности', async () => {
      const token = await login(app, 'opora@alliance.local');
      const areas = await http().get('/api/responsibility-areas').set(auth(token)).expect(200);
      const wgs = await http().get('/api/working-groups/brief').set(auth(token)).expect(200);
      const events = areas.body.find((a: { code: string }) => a.code === 'EVENTS');
      const wgArea = areas.body.find((a: { code: string }) => a.code === 'WORKING_GROUP');

      const created = await http()
        .post(`/api/organizations/${oporaId}/employees`)
        .set(auth(token))
        .send({
          fullName: 'Новикова Дарья Андреевна',
          position: 'Менеджер',
          email: 'novikova@opora.example',
          responsibilities: [{ areaId: events.id }, { areaId: wgArea.id, workingGroupId: wgs.body[0].id }, { areaId: events.id }],
        })
        .expect(201);
      expect(created.body.responsibilities).toHaveLength(2);

      const updated = await http()
        .patch(`/api/organizations/${oporaId}/employees/${created.body.id}`)
        .set(auth(token))
        .send({ responsibilities: [{ areaId: events.id }] })
        .expect(200);
      expect(updated.body.responsibilities).toHaveLength(1);

      await http().delete(`/api/organizations/${oporaId}/employees/${created.body.id}`).set(auth(token)).expect(204);
    });

    it('чужие сотрудники недоступны обычному члену, но видны секретарю', async () => {
      const member = await login(app, 'kazhdyi@alliance.local');
      await http().get(`/api/organizations/${oporaId}/employees`).set(auth(member)).expect(403);
      await http().post(`/api/organizations/${oporaId}/employees`).set(auth(member)).send({ fullName: 'Чужой' }).expect(403);
      const secretary = await loginSecretary(app);
      const list = await http().get(`/api/organizations/${oporaId}/employees`).set(auth(secretary)).expect(200);
      expect(list.body.length).toBeGreaterThan(0);
    });

    it('кандидат не управляет сотрудниками', async () => {
      // Собственный кандидат: другие наборы тестов принимают демо-кандидатов в члены
      const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: 'opora@alliance.local' } })).passwordHash;
      const cand = await prisma.organization.create({
        data: { name: 'Кандидат для теста сотрудников', regionCode: 'RU-TOM', status: 'CANDIDATE', users: { create: { email: 'emp-candidate@alliance.local', fullName: 'Кандидатов К. К.', status: 'ACTIVE', passwordHash } } },
      });
      const token = await login(app, 'emp-candidate@alliance.local');
      await http().post(`/api/organizations/${cand.id}/employees`).set(auth(token)).send({ fullName: 'Сотрудник' }).expect(403);
    });
  });

  describe('аудит', () => {
    it('журнал аудита нельзя изменить или удалить даже напрямую в БД', async () => {
      await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
      const row = await prisma.auditLog.findFirstOrThrow();
      await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'x' } })).rejects.toThrow(/append-only/);
    });

    it('в аудит не попадают хэши паролей и секреты', async () => {
      const rows = await prisma.auditLog.findMany({ where: { entityType: 'User' } });
      const text = JSON.stringify(rows.map((r) => [r.before, r.after]));
      expect(text).not.toMatch(/\$argon2/);
    });

    it('член не имеет доступа к журналу аудита', async () => {
      await http().get('/api/admin/audit').set(auth(await login(app, 'opora@alliance.local'))).expect(403);
    });
  });

  it('справочник содержит 89 регионов', async () => {
    const res = await http().get('/api/regions').set(auth(await login(app, 'opora@alliance.local'))).expect(200);
    expect(res.body).toHaveLength(89);
  });
});

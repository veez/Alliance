import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mskYear } from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import { VotesScheduler } from '../src/votes/votes.scheduler';
import { auth, createApp, login, loginAdminWith2fa, loginSecretary } from './helpers';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

describe('Голосования (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let secretary: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
  });
  afterAll(() => app.close());

  const draft = (extra: Record<string, unknown> = {}) => ({
    title: 'Тестовое голосование',
    scenario: 'OTHER',
    endsAt: inDays(3),
    eligibility: 'ALL_MEMBERS',
    questions: [
      { text: 'Утвердить документ?', format: 'YES_NO_ABSTAIN' },
      { text: 'Выберите площадку', format: 'SINGLE', options: ['Москва', 'Казань'] },
    ],
    ...extra,
  });

  async function createAndPublish(body = draft()) {
    const created = await http().post('/api/votes').set(auth(secretary)).send(body).expect(201);
    await http().post(`/api/votes/${created.body.id}/publish`).set(auth(secretary)).expect(200);
    const full = await http().get(`/api/votes/${created.body.id}`).set(auth(secretary)).expect(200);
    return full.body;
  }

  const ballotFor = (vote: { questions: Array<{ id: string; options: Array<{ id: string }> }> }, picks: number[]) => ({
    answers: vote.questions.map((q, i) => ({ questionId: q.id, optionIds: [q.options[picks[i]].id] })),
  });

  describe('создание и публикация', () => {
    it('член Альянса не может создать голосование', async () => {
      await http().post('/api/votes').set(auth(await login(app, 'opora@alliance.local'))).send(draft()).expect(403);
    });

    it('валидация черновика', async () => {
      await http().post('/api/votes').set(auth(secretary)).send(draft({ questions: [] })).expect(400);
      const one = await http()
        .post('/api/votes')
        .set(auth(secretary))
        .send(draft({ questions: [{ text: 'Один вариант?', format: 'SINGLE', options: ['Только один'] }] }))
        .expect(400);
      expect(one.body.message).toContain('минимум два');
      await http().post('/api/votes').set(auth(secretary)).send(draft({ scenario: 'ADMISSION' })).expect(400);
      await http().post('/api/votes').set(auth(secretary)).send(draft({ eligibility: 'LIST', organizationIds: [] })).expect(400);
    });

    it('черновик не виден членам; после публикации состав участников фиксируется', async () => {
      const created = await http().post('/api/votes').set(auth(secretary)).send(draft()).expect(201);
      const member = await login(app, 'opora@alliance.local');
      await http().get(`/api/votes/${created.body.id}`).set(auth(member)).expect(404);

      await http().post(`/api/votes/${created.body.id}/publish`).set(auth(secretary)).expect(200);
      const members = await prisma.organization.count({ where: { status: 'MEMBER' } });
      const vote = await http().get(`/api/votes/${created.body.id}`).set(auth(member)).expect(200);
      expect(vote.body.result.eligibleCount).toBe(members);
      expect(vote.body.canVote).toBe(true);
      // После публикации черновик не редактируется
      await http().patch(`/api/votes/${created.body.id}`).set(auth(secretary)).send(draft({ title: 'Другое' })).expect(409);
    });

    it('LIST: голосуют только указанные организации', async () => {
      const [a, b] = await prisma.organization.findMany({ where: { status: 'MEMBER', users: { some: { email: { in: ['opora@alliance.local', 'apk@alliance.local'] } } } } });
      const vote = await createAndPublish(draft({ eligibility: 'LIST', organizationIds: [a.id, b.id] }));
      expect(vote.result.eligibleCount).toBe(2);
      const outsider = await login(app, 'kazhdyi@alliance.local');
      await http().get(`/api/votes/${vote.id}`).set(auth(outsider)).expect(404);
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(outsider)).send(ballotFor(vote, [0, 0])).expect(404);
    });

    it('PAID_DUES: голосуют только организации с оплаченным взносом текущего года', async () => {
      const vote = await createAndPublish(draft({ eligibility: 'PAID_DUES' }));
      const paid = await prisma.dues.count({ where: { year: mskYear(), status: { in: ['PAID', 'WAIVED'] }, organization: { status: 'MEMBER' } } });
      expect(vote.result.eligibleCount).toBe(paid);
    });

    it('если участников нет — публикация невозможна', async () => {
      const created = await http().post('/api/votes').set(auth(secretary)).send(draft()).expect(201);
      // Все члены временно исключены из списка: снимок состава пуст
      await prisma.vote.update({ where: { id: created.body.id }, data: { eligibility: 'LIST' } });
      const res = await http().post(`/api/votes/${created.body.id}/publish`).set(auth(secretary)).expect(400);
      expect(res.body.message).toContain('Нет ни одной организации');
    });
  });

  describe('голосование', () => {
    it('член голосует от организации, может изменить голос; итоги поимённые', async () => {
      const vote = await createAndPublish();
      const token = await login(app, 'opora@alliance.local');
      const first = await http().post(`/api/votes/${vote.id}/ballot`).set(auth(token)).send(ballotFor(vote, [0, 1])).expect(200);
      expect(first.body.changed).toBe(false);
      const second = await http().post(`/api/votes/${vote.id}/ballot`).set(auth(token)).send(ballotFor(vote, [1, 0])).expect(200);
      expect(second.body.changed).toBe(true);

      const view = await http().get(`/api/votes/${vote.id}`).set(auth(await login(app, 'kazhdyi@alliance.local'))).expect(200);
      expect(view.body.result.participatedCount).toBe(1);
      const yna = view.body.result.questions[0];
      expect(yna.options.map((o: { count: number }) => o.count)).toEqual([0, 1, 0]);
      // Поимённая таблица видна участникам открытого голосования
      const row = view.body.rows.find((r: { votedBy: unknown }) => r.votedBy);
      expect(row.votedBy.fullName).toBe('Иванова Мария Сергеевна');
      expect(row.answers[vote.questions[0].id][0].text).toBe('Против');

      const audit = await prisma.auditLog.findMany({ where: { entityType: 'Vote', entityId: vote.id, action: { in: ['vote.cast', 'vote.recast'] } } });
      expect(audit.map((a) => a.action).sort()).toEqual(['vote.cast', 'vote.recast']);
    });

    it('один голос на организацию: второй пользователь организации меняет тот же голос', async () => {
      const vote = await createAndPublish();
      const org = await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'ucmz@alliance.local' } } } });
      await prisma.user.update({ where: { email: 'new.member@alliance.local' }, data: { status: 'ACTIVE', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { email: 'ucmz@alliance.local' } })).passwordHash, organizationId: org.id } });
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, 'ucmz@alliance.local'))).send(ballotFor(vote, [0, 0])).expect(200);
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, 'new.member@alliance.local'))).send(ballotFor(vote, [1, 1])).expect(200);
      const parts = await prisma.voteParticipation.findMany({ where: { voteId: vote.id } });
      expect(parts).toHaveLength(1);
      const answers = await prisma.voteAnswer.count({ where: { voteId: vote.id } });
      expect(answers).toBe(2);
    });

    it('неполный или некорректный бюллетень → 400', async () => {
      const vote = await createAndPublish();
      const token = await login(app, 'sask@alliance.local');
      const res = await http()
        .post(`/api/votes/${vote.id}/ballot`)
        .set(auth(token))
        .send({ answers: [{ questionId: vote.questions[0].id, optionIds: [vote.questions[0].options[0].id] }] })
        .expect(400);
      expect(res.body.message).toBe('Вопрос 2: нет ответа');
      await http()
        .post(`/api/votes/${vote.id}/ballot`)
        .set(auth(token))
        .send({ answers: vote.questions.map((q: { id: string; options: Array<{ id: string }> }) => ({ questionId: q.id, optionIds: q.options.map((o) => o.id) })) })
        .expect(400);
    });

    it('партнёр и кандидат не голосуют; секретарь без организации — тоже', async () => {
      const vote = await createAndPublish();
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, 'izdat@alliance.local'))).send(ballotFor(vote, [0, 0])).expect(403);
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, 'dvcsp@alliance.local'))).send(ballotFor(vote, [0, 0])).expect(403);
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(secretary)).send(ballotFor(vote, [0, 0])).expect(403);
    });

    it('после срока голоса не принимаются; продление открывает голосование', async () => {
      const vote = await createAndPublish();
      await prisma.vote.update({ where: { id: vote.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      const token = await login(app, 'vmeste@alliance.local');
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(token)).send(ballotFor(vote, [0, 0])).expect(409);
      await http().post(`/api/votes/${vote.id}/extend`).set(auth(secretary)).send({ endsAt: inDays(1) }).expect(200);
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(token)).send(ballotFor(vote, [0, 0])).expect(200);
    });

    it('голосование, которое ещё не началось, не принимает голоса', async () => {
      const vote = await createAndPublish(draft({ startsAt: inDays(1), endsAt: inDays(2) }));
      const res = await http().get(`/api/votes/${vote.id}`).set(auth(await login(app, 'opora@alliance.local'))).expect(200);
      expect(res.body.canVote).toBe(false);
      expect(res.body.cannotVoteReason).toMatch(/начнётся/);
    });
  });

  describe('подведение итогов', () => {
    it('досрочное закрытие: итоги фиксируются, протокол PDF и CSV доступны участникам', async () => {
      const vote = await createAndPublish();
      const voters = ['opora', 'apk', 'kazhdyi', 'ucmz', 'sask'];
      for (const [i, l] of voters.entries()) {
        await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, `${l}@alliance.local`))).send(ballotFor(vote, [i < 4 ? 0 : 1, 0])).expect(200);
      }
      await http().post(`/api/votes/${vote.id}/close`).set(auth(await login(app, 'opora@alliance.local'))).expect(403);
      const closed = await http().post(`/api/votes/${vote.id}/close`).set(auth(secretary)).expect(200);
      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.protocolFileId).toBeTruthy();

      const member = await login(app, 'belova@alliance.local');
      const view = await http().get(`/api/votes/${vote.id}`).set(auth(member)).expect(200);
      expect(view.body.result.quorumReached).toBe(true);
      expect(view.body.result.questions[0].outcome.kind).toBe('ACCEPTED');
      expect(view.body.result.questions[1].outcome).toMatchObject({ kind: 'WINNER' });

      // После закрытия голосовать нельзя
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(member)).send(ballotFor(vote, [0, 0])).expect(409);

      const pdf = await http().get(`/api/votes/${vote.id}/protocol.pdf`).set(auth(member)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

      const csv = await http().get(`/api/votes/${vote.id}/export.csv`).set(auth(member)).expect(200);
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toContain('Иванова Мария Сергеевна');
      expect(csv.text).toContain('не голосовала');
    });

    it('без кворума решение не принято', async () => {
      const vote = await createAndPublish();
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, 'opora@alliance.local'))).send(ballotFor(vote, [0, 0])).expect(200);
      const closed = await http().post(`/api/votes/${vote.id}/close`).set(auth(secretary)).expect(200);
      expect(closed.body.result.quorumReached).toBe(false);
      expect(closed.body.result.questions[0].outcome.kind).toBe('NO_QUORUM');
    });

    it('планировщик закрывает голосования по сроку и рассылает напоминания не проголосовавшим', async () => {
      const scheduler = app.get(VotesScheduler);
      const vote = await createAndPublish(draft({ reminderHours: [24] }));
      await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, 'opora@alliance.local'))).send(ballotFor(vote, [0, 0])).expect(200);

      const remindAt = new Date(new Date(vote.endsAt).getTime() - 12 * 3_600_000);
      const sent = await scheduler.sendReminders(remindAt);
      expect(sent).toBeGreaterThan(0);
      const logs = await prisma.voteReminderLog.findMany({ where: { voteId: vote.id } });
      const opora = await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'opora@alliance.local' } } } });
      expect(logs.find((l) => l.organizationId === opora.id)).toBeUndefined();
      // Повторно не отправляет
      expect(await scheduler.sendReminders(remindAt)).toBe(0);

      await scheduler.closeExpired(new Date(new Date(vote.endsAt).getTime() + 1000));
      const after = await prisma.vote.findUniqueOrThrow({ where: { id: vote.id } });
      expect(after.status).toBe('CLOSED');
      const audit = await prisma.auditLog.findFirst({ where: { entityId: vote.id, action: 'vote.closed_by_deadline' } });
      expect(audit).not.toBeNull();
    });
  });

  describe('приём в члены', () => {
    it('кандидат не видит голосование по своей кандидатуре до решения; после — видит, админ меняет статус по итогам', async () => {
      const candidateOrg = await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'dvcsp@alliance.local' } } } });
      const vote = await createAndPublish(
        draft({ scenario: 'ADMISSION', subjectOrganizationId: candidateOrg.id, questions: [{ text: 'Принять кандидата?', format: 'YES_NO_ABSTAIN' }] }),
      );
      const candidate = await login(app, 'dvcsp@alliance.local');
      await http().get(`/api/votes/${vote.id}`).set(auth(candidate)).expect(404);
      const list = await http().get('/api/votes').set(auth(candidate)).expect(200);
      expect(list.body.items.find((v: { id: string }) => v.id === vote.id)).toBeUndefined();

      for (const l of ['opora', 'apk', 'kazhdyi', 'ucmz', 'sask']) {
        await http().post(`/api/votes/${vote.id}/ballot`).set(auth(await login(app, `${l}@alliance.local`))).send(ballotFor(vote, [0])).expect(200);
      }
      await http().post(`/api/votes/${vote.id}/close`).set(auth(secretary)).expect(200);
      const seen = await http().get(`/api/votes/${vote.id}`).set(auth(candidate)).expect(200);
      expect(seen.body.result.questions[0].outcome.kind).toBe('ACCEPTED');

      const admin = await loginAdminWith2fa(app, prisma);
      await http().post(`/api/organizations/${candidateOrg.id}/status`).set(auth(admin)).send({ status: 'MEMBER', voteId: vote.id, reason: `По итогам голосования № ${vote.number}` }).expect(201);
      const history = await prisma.organizationStatusHistory.findFirstOrThrow({ where: { organizationId: candidateOrg.id, toStatus: 'MEMBER' } });
      expect(history.voteId).toBe(vote.id);
    });
  });

  describe('вложения и история', () => {
    it('документ прикладывается к черновику; после публикации менять нельзя; скачивать могут участники', async () => {
      const created = await http().post('/api/votes').set(auth(secretary)).send(draft({ scenario: 'DOCUMENT_APPROVAL' })).expect(201);
      const up = await http()
        .post(`/api/votes/${created.body.id}/files`)
        .set(auth(secretary))
        .attach('file', Buffer.from('Текст письма'), { filename: 'Письмо.txt', contentType: 'text/plain' })
        .expect(201);
      expect(up.body.originalName).toBe('Письмо.txt');
      await http().post(`/api/votes/${created.body.id}/publish`).set(auth(secretary)).expect(200);
      await http()
        .post(`/api/votes/${created.body.id}/files`)
        .set(auth(secretary))
        .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' })
        .expect(409);
      const member = await login(app, 'opora@alliance.local');
      const file = await http().get(`/api/votes/${created.body.id}/files/${up.body.id}`).set(auth(member)).expect(200);
      expect(file.text).toBe('Текст письма');
      await http().get(`/api/votes/${created.body.id}/files/${up.body.id}`).set(auth(await login(app, 'izdat@alliance.local'))).expect(404);
    });

    it('история: фильтры по вкладке, сценарию и поиску по номеру', async () => {
      const active = await http().get('/api/votes?tab=active&pageSize=100').set(auth(secretary)).expect(200);
      expect(active.body.items.every((v: { status: string }) => v.status === 'ACTIVE')).toBe(true);
      const archive = await http().get('/api/votes?tab=archive&scenario=ELECTION').set(auth(secretary)).expect(200);
      expect(archive.body.items.length).toBeGreaterThan(0);
      expect(archive.body.items.every((v: { scenario: string }) => v.scenario === 'ELECTION')).toBe(true);
      const n = archive.body.items[0].number;
      const byNumber = await http().get(`/api/votes?search=${n}&pageSize=100`).set(auth(secretary)).expect(200);
      expect(byNumber.body.items.map((v: { number: number }) => v.number)).toContain(n);
      // Член Альянса не видит черновики
      const drafts = await http().get('/api/votes?tab=drafts').set(auth(await login(app, 'opora@alliance.local'))).expect(200);
      expect(drafts.body.total).toBe(0);
    });
  });
});

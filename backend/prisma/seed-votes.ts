/** Демо-голосования (этап 2). Добавляются, если в БД ещё нет ни одного голосования. */
import { PrismaClient, QuestionFormat, VoteEligibility, VoteScenario, VoteStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { computeResults, YES_NO_ABSTAIN_OPTIONS } from '../src/votes/vote-logic';

type Q = { text: string; format: QuestionFormat; options?: string[]; minChoices?: number; maxChoices?: number };
/** Голос: login организации → по каждому вопросу индексы вариантов (для рейтинга — в порядке мест) */
type Ballots = Record<string, number[][]>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function seedVotes(prisma: PrismaClient) {
  if (await prisma.vote.count()) {
    console.log('Голосования уже есть — демо-голосования не добавляются');
    return;
  }
  const secretary = await prisma.user.findUnique({ where: { email: 'secretary@alliance.local' } });
  if (!secretary) return;

  const orgUsers = await prisma.user.findMany({
    where: { email: { endsWith: '@alliance.local' }, organizationId: { not: null }, status: 'ACTIVE' },
    include: { organization: true },
  });
  const byLogin = Object.fromEntries(orgUsers.map((u) => [u.email.split('@')[0], u]));
  const members = orgUsers.filter((u) => u.organization!.status === 'MEMBER');
  const candidate = orgUsers.find((u) => u.organization!.status === 'CANDIDATE' && u.email.startsWith('teplydom')) ?? orgUsers.find((u) => u.organization!.status === 'CANDIDATE');
  const now = Date.now();

  async function createVote(opts: {
    title: string;
    description?: string;
    scenario: VoteScenario;
    status: VoteStatus;
    startsAt: number;
    endsAt: number;
    eligibility?: VoteEligibility;
    voters?: string[];
    subjectOrganizationId?: string;
    questions: Q[];
    ballots?: Ballots;
    reminders?: number[];
  }) {
    const vote = await prisma.vote.create({
      data: {
        title: opts.title,
        description: opts.description,
        scenario: opts.scenario,
        status: opts.status,
        startsAt: opts.status === 'DRAFT' ? null : new Date(opts.startsAt),
        endsAt: new Date(opts.endsAt),
        closedAt: opts.status === 'CLOSED' ? new Date(opts.endsAt) : null,
        quorumPercent: 50,
        eligibility: opts.eligibility ?? 'ALL_MEMBERS',
        subjectOrganizationId: opts.subjectOrganizationId,
        reminders: (opts.reminders ?? [48, 2]).map((beforeHours) => ({ beforeHours })),
        createdById: secretary!.id,
        questions: {
          create: opts.questions.map((q, position) => {
            const options = q.format === 'YES_NO_ABSTAIN' ? YES_NO_ABSTAIN_OPTIONS : q.options!;
            const n = options.length;
            return {
              position,
              text: q.text,
              format: q.format,
              minChoices: q.format === 'RANKING' ? n : (q.minChoices ?? 1),
              maxChoices: q.format === 'RANKING' ? n : (q.maxChoices ?? (q.format === 'MULTIPLE' ? n : 1)),
              options: { create: options.map((text, i) => ({ position: i, text })) },
            };
          }),
        },
      },
      include: { questions: { include: { options: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } } },
    });
    if (opts.status === 'DRAFT') return vote;

    const voterUsers = opts.voters ? opts.voters.map((l) => byLogin[l]).filter(Boolean) : members;
    await prisma.voteEligibleVoter.createMany({ data: voterUsers.map((u) => ({ voteId: vote.id, organizationId: u.organizationId! })) });

    const answers: Array<{ organizationId: string; questionId: string; optionId: string; rank: number | null }> = [];
    for (const [login, perQuestion] of Object.entries(opts.ballots ?? {})) {
      const u = byLogin[login];
      if (!u) continue;
      const votedAt = new Date(Math.min(opts.startsAt + (answers.length + 1) * 3 * HOUR, now - HOUR));
      await prisma.voteParticipation.create({ data: { voteId: vote.id, organizationId: u.organizationId!, votedByUserId: u.id, votedAt } });
      perQuestion.forEach((choice, qi) => {
        const q = vote.questions[qi];
        choice.forEach((optIndex, i) =>
          answers.push({ organizationId: u.organizationId!, questionId: q.id, optionId: q.options[optIndex].id, rank: q.format === 'RANKING' ? i + 1 : null }),
        );
      });
    }
    await prisma.voteAnswer.createMany({ data: answers.map((a) => ({ ...a, voteId: vote.id })) });

    if (opts.status === 'CLOSED') {
      const result = computeResults({
        questions: vote.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ id: o.id, text: o.text, position: o.position })) })),
        eligibleCount: voterUsers.length,
        quorumPercent: vote.quorumPercent,
        participantIds: [...new Set(answers.map((a) => a.organizationId))],
        answers,
        now: new Date(opts.endsAt),
      });
      await prisma.vote.update({ where: { id: vote.id }, data: { result: result as never } });
    }
    return vote;
  }

  // 1. Завершённое: приём в члены (решение принято — администратор может сменить статус кандидата)
  if (candidate) {
    await createVote({
      title: `Приём в члены Альянса: ${candidate.organization!.name}`,
      description: 'Заявка рассмотрена на заседании рабочей группы по стандартам. Анкета и устав кандидата — в карточке организации.',
      scenario: 'ADMISSION',
      status: 'CLOSED',
      startsAt: now - 20 * DAY,
      endsAt: now - 13 * DAY,
      subjectOrganizationId: candidate.organizationId!,
      questions: [{ text: `Принять ${candidate.organization!.name} в члены Альянса «Ценность каждого»?`, format: 'YES_NO_ABSTAIN' }],
      ballots: { opora: [[0]], apk: [[0]], kazhdyi: [[0]], ucmz: [[2]], sask: [[0]], vmeste: [[1]] },
    });
  }

  // 2. Завершённое: выборы + рейтинг приоритетов
  await createVote({
    title: 'Выборы координатора Альянса и приоритеты на 2027 год',
    scenario: 'ELECTION',
    status: 'CLOSED',
    startsAt: now - 40 * DAY,
    endsAt: now - 33 * DAY,
    questions: [
      { text: 'Координатор Альянса на 2027 год', format: 'SINGLE', options: ['Иванова Мария Сергеевна', 'Петров Андрей Викторович', 'Гарипова Алсу Рашидовна'] },
      {
        text: 'Расставьте приоритеты работы Альянса на 2027 год',
        format: 'RANKING',
        options: ['Стандарты сопровождения семьи', 'Взаимодействие с органами власти', 'Обучение специалистов', 'Информационная кампания'],
      },
    ],
    ballots: {
      opora: [[0], [0, 2, 1, 3]],
      apk: [[1], [2, 0, 1, 3]],
      kazhdyi: [[0], [1, 0, 3, 2]],
      ucmz: [[0], [2, 0, 1, 3]],
      sask: [[0], [0, 2, 3, 1]],
      belova: [[1], [2, 1, 0, 3]],
    },
  });

  // 3. Идёт: согласование письма (с приложенным документом). Центр «Опора» ещё не голосовал.
  const letter = await createVote({
    title: 'Согласование обращения в Минтруд о стандарте сопровождения семей',
    description: 'Проект обращения подготовлен рабочей группой по взаимодействию с органами власти. Текст — во вложении.',
    scenario: 'DOCUMENT_APPROVAL',
    status: 'ACTIVE',
    startsAt: now - 2 * DAY,
    endsAt: now + 3 * DAY,
    questions: [{ text: 'Согласовать направление обращения в редакции из вложения?', format: 'YES_NO_ABSTAIN' }],
    ballots: { apk: [[0]], kazhdyi: [[0]], ucmz: [[2]] },
  });
  const text =
    'ПРОЕКТ\n\nМинистерство труда и социальной защиты Российской Федерации\n\n' +
    'Альянс «Ценность каждого» предлагает рассмотреть проект стандарта сопровождения семей, ' +
    'воспитывающих детей с особенностями развития...\n\n(демо-документ для портала)';
  const buffer = Buffer.from(text, 'utf8');
  const storageKey = `seed/${randomUUID()}`;
  const path = resolve(process.cwd(), process.env.STORAGE_DIR ?? 'var/files', storageKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
  const file = await prisma.file.create({
    data: { storageKey, originalName: 'Проект обращения в Минтруд.txt', mime: 'text/plain', size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), uploadedById: secretary.id },
  });
  await prisma.fileLink.create({ data: { fileId: file.id, entityType: 'VOTE', entityId: letter.id, docType: 'ATTACHMENT' } });

  // 4. Идёт: участие в мероприятии, ограниченный список участников
  await createVote({
    title: 'Участие Альянса во Всероссийском форуме «Семья и общество»',
    description: 'Форум пройдёт 10–12 декабря в Москве. Нужно определить формат участия.',
    scenario: 'EVENT_PARTICIPATION',
    status: 'ACTIVE',
    startsAt: now - DAY,
    endsAt: now + 6 * DAY,
    eligibility: 'LIST',
    voters: ['opora', 'apk', 'kazhdyi', 'ucmz', 'vmeste'],
    questions: [
      { text: 'Участвует ли Альянс в форуме официально?', format: 'YES_NO_ABSTAIN' },
      { text: 'Форматы участия (не более двух)', format: 'MULTIPLE', options: ['Стенд Альянса', 'Секция с докладами', 'Мастер-класс', 'Только делегация'], minChoices: 1, maxChoices: 2 },
    ],
    ballots: { kazhdyi: [[0], [0, 1]], vmeste: [[0], [1, 2]] },
  });

  // 5. Черновик
  await createVote({
    title: 'Утверждение плана мероприятий Альянса на 2027 год',
    scenario: 'OTHER',
    status: 'DRAFT',
    startsAt: now,
    endsAt: now + 14 * DAY,
    questions: [{ text: 'Утвердить план мероприятий на 2027 год?', format: 'YES_NO_ABSTAIN' }],
  });

  console.log('Демо-голосования: 2 завершённых, 2 идущих, 1 черновик');
}

// Для запуска по отдельности: npx ts-node --transpile-only prisma/seed-votes.ts
if (require.main === module) {
  const prisma = new PrismaClient();
  seedVotes(prisma).finally(() => prisma.$disconnect());
}

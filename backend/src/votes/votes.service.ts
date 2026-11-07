import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DuesStatus, FileEntityType, OrganizationStatus, Prisma, QuestionFormat, VoteEligibility, VoteScenario, VoteStatus } from '@prisma/client';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { DuesService } from '../dues/dues.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Page, pageArgs } from '../common/pagination';
import { fmtMsk, mskYear } from '../common/time';
import { FilesService, UploadedFileLike } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BallotError, computeResults, QuestionDef, validateBallot, VoteResult, YES_NO_ABSTAIN_OPTIONS } from './vote-logic';
import { CastBallotDto, QuestionDto, VoteDraftDto, VoteListQuery } from './votes.dto';
import { buildVoteProtocolPdf } from './votes.pdf';

const NO_ID = '00000000-0000-0000-0000-000000000000';

export const VOTE_INCLUDE = {
  questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } },
  createdBy: { select: { id: true, fullName: true } },
  subjectOrganization: { select: { id: true, name: true, shortName: true, status: true } },
} satisfies Prisma.VoteInclude;

export type VoteWithQuestions = Prisma.VoteGetPayload<{ include: typeof VOTE_INCLUDE }>;

/** Поимённая строка: организация из списка участников и её голос (если есть). */
export interface NamedVoteRow {
  organizationId: string;
  organizationName: string;
  regionName: string;
  votedAt: Date | null;
  votedBy: { id: string; fullName: string } | null;
  /** questionId → выбранные варианты (для рейтинга — в порядке мест) */
  answers: Record<string, Array<{ optionId: string; text: string; rank: number | null }>>;
}

export interface VoteFullData {
  vote: VoteWithQuestions;
  result: VoteResult;
  rows: NamedVoteRow[];
}

@Injectable()
export class VotesService {
  private readonly logger = new Logger('Votes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly dues: DuesService,
  ) {}

  // ───────────── Доступ ─────────────

  canManage(user: AuthUser) {
    return user.permissions.has(P.VOTES_CREATE);
  }

  private canReadAll(user: AuthUser) {
    return user.permissions.has(P.VOTES_READ_ALL) || this.canManage(user);
  }

  /**
   * Видимость: «видящие всё» — любые голосования, включая черновики.
   * Остальные — опубликованные голосования, где их организация в списке участников.
   * Кандидат видит голосование по своей кандидатуре только после его завершения.
   */
  private visibilityWhere(user: AuthUser): Prisma.VoteWhereInput {
    if (this.canReadAll(user)) return {};
    const org = user.organizationId ?? NO_ID;
    return {
      status: { not: VoteStatus.DRAFT },
      OR: [
        {
          eligibleVoters: { some: { organizationId: org } },
          OR: [{ subjectOrganizationId: null }, { subjectOrganizationId: { not: org } }],
        },
        { subjectOrganizationId: org, status: VoteStatus.CLOSED },
      ],
    };
  }

  private async loadVisible(id: string, user: AuthUser): Promise<VoteWithQuestions> {
    const vote = await this.prisma.vote.findFirst({ where: { id, ...this.visibilityWhere(user) }, include: VOTE_INCLUDE });
    if (!vote) throw new NotFoundException('Голосование не найдено');
    return vote;
  }

  private async loadForManage(id: string, user: AuthUser): Promise<VoteWithQuestions> {
    if (!this.canManage(user)) throw new ForbiddenException('Недостаточно прав');
    const vote = await this.prisma.vote.findUnique({ where: { id }, include: VOTE_INCLUDE });
    if (!vote) throw new NotFoundException('Голосование не найдено');
    return vote;
  }

  // ───────────── Список и карточка ─────────────

  async list(q: VoteListQuery, user: AuthUser): Promise<Page<unknown>> {
    const and: Prisma.VoteWhereInput[] = [this.visibilityWhere(user)];
    if (q.tab === 'active') and.push({ status: VoteStatus.ACTIVE });
    if (q.tab === 'archive') and.push({ status: { in: [VoteStatus.CLOSED, VoteStatus.CANCELLED] } });
    if (q.tab === 'drafts') and.push({ status: VoteStatus.DRAFT });
    if (q.status) and.push({ status: q.status });
    if (q.scenario) and.push({ scenario: q.scenario });
    if (q.createdById) and.push({ createdById: q.createdById });
    if (q.from || q.to) and.push({ endsAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } });
    if (q.search) {
      const n = Number(q.search.replace(/^№\s*/, ''));
      and.push({ OR: [{ title: { contains: q.search, mode: 'insensitive' } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])] });
    }
    const where: Prisma.VoteWhereInput = { AND: and };
    const org = user.organizationId ?? NO_ID;
    const [rows, total] = await Promise.all([
      this.prisma.vote.findMany({
        where,
        orderBy: q.tab === 'active' ? { endsAt: 'asc' } : { createdAt: 'desc' },
        include: {
          createdBy: { select: { id: true, fullName: true } },
          subjectOrganization: { select: { id: true, name: true, shortName: true } },
          _count: { select: { eligibleVoters: true, participations: true } },
          participations: { where: { organizationId: org }, select: { votedAt: true } },
          eligibleVoters: { where: { organizationId: org }, select: { organizationId: true } },
        },
        ...pageArgs(q),
      }),
      this.prisma.vote.count({ where }),
    ]);
    const now = new Date();
    const items = rows.map(({ participations, eligibleVoters, _count, result, ...v }) => ({
      ...v,
      eligibleCount: _count.eligibleVoters,
      participatedCount: _count.participations,
      myVotedAt: participations[0]?.votedAt ?? null,
      canVote: this.voteOpen(v, now) && eligibleVoters.length > 0 && user.permissions.has(P.VOTE_CAST),
      quorumReached: result ? (result as unknown as VoteResult).quorumReached : null,
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  private voteOpen(v: { status: VoteStatus; startsAt: Date | null; endsAt: Date }, now = new Date()) {
    return v.status === VoteStatus.ACTIVE && (!v.startsAt || v.startsAt <= now) && v.endsAt > now;
  }

  /** Полные данные: голосование, итоги (зафиксированные или текущие), поимённая таблица. */
  async loadFull(vote: VoteWithQuestions): Promise<VoteFullData> {
    const [eligible, participations, answers] = await Promise.all([
      this.prisma.voteEligibleVoter.findMany({
        where: { voteId: vote.id },
        include: { organization: { select: { id: true, name: true, shortName: true, region: { select: { name: true } } } } },
      }),
      this.prisma.voteParticipation.findMany({ where: { voteId: vote.id }, include: { votedBy: { select: { id: true, fullName: true } } } }),
      this.prisma.voteAnswer.findMany({ where: { voteId: vote.id }, include: { option: { select: { text: true } } }, orderBy: [{ rank: 'asc' }] }),
    ]);
    const result =
      vote.status === VoteStatus.CLOSED && vote.result
        ? (vote.result as unknown as VoteResult)
        : computeResults({
            questions: this.questionDefs(vote),
            eligibleCount: eligible.length,
            quorumPercent: vote.quorumPercent,
            participantIds: participations.map((p) => p.organizationId),
            answers,
          });

    const partByOrg = new Map(participations.map((p) => [p.organizationId, p]));
    const rows: NamedVoteRow[] = eligible
      .map((e) => {
        const p = partByOrg.get(e.organizationId);
        const own = answers.filter((a) => a.organizationId === e.organizationId);
        const byQ: NamedVoteRow['answers'] = {};
        for (const a of own) (byQ[a.questionId] ??= []).push({ optionId: a.optionId, text: a.option.text, rank: a.rank });
        return {
          organizationId: e.organizationId,
          organizationName: e.organization.shortName || e.organization.name,
          regionName: e.organization.region.name,
          votedAt: p?.votedAt ?? null,
          votedBy: p?.votedBy ?? null,
          answers: byQ,
        };
      })
      .sort((a, b) => a.organizationName.localeCompare(b.organizationName, 'ru'));
    return { vote, result, rows };
  }

  async get(id: string, user: AuthUser) {
    const vote = await this.loadVisible(id, user);
    const { result, rows } = await this.loadFull(vote);
    const attachments = await this.attachmentsOf(id);
    const org = user.organizationId;
    const myRow = org ? rows.find((r) => r.organizationId === org) : undefined;
    const isEligible = !!myRow;

    let cannotVoteReason: string | null = null;
    if (!user.permissions.has(P.VOTE_CAST)) cannotVoteReason = 'Голосуют только члены Альянса';
    else if (!isEligible) cannotVoteReason = 'Ваша организация не входит в список участников голосования';
    else if (vote.status !== VoteStatus.ACTIVE) cannotVoteReason = 'Голосование не идёт';
    else if (vote.startsAt && vote.startsAt > new Date()) cannotVoteReason = `Голосование начнётся ${fmtMsk(vote.startsAt)}`;
    else if (vote.endsAt <= new Date()) cannotVoteReason = 'Срок голосования истёк';

    return {
      ...vote,
      result,
      rows,
      attachments,
      eligibleOrganizationIds: rows.map((r) => r.organizationId),
      my: myRow ? { votedAt: myRow.votedAt, votedBy: myRow.votedBy, answers: myRow.answers } : null,
      canVote: cannotVoteReason === null,
      cannotVoteReason,
      canManage: this.canManage(user),
    };
  }

  // ───────────── Черновик ─────────────

  private questionDefs(vote: VoteWithQuestions): QuestionDef[] {
    return vote.questions.map((q) => ({
      id: q.id,
      text: q.text,
      position: q.position,
      format: q.format,
      minChoices: q.minChoices,
      maxChoices: q.maxChoices,
      options: q.options.map((o) => ({ id: o.id, text: o.text, position: o.position })),
    }));
  }

  private normalizeQuestions(questions: QuestionDto[]): Prisma.VoteQuestionCreateWithoutVoteInput[] {
    return questions.map((q, position) => {
      const label = `Вопрос ${position + 1}`;
      let options: string[];
      let minChoices = 1;
      let maxChoices = 1;
      if (q.format === QuestionFormat.YES_NO_ABSTAIN) {
        options = YES_NO_ABSTAIN_OPTIONS;
      } else {
        options = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
        if (options.length < 2) throw new BadRequestException(`${label}: нужно минимум два варианта`);
        if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new BadRequestException(`${label}: варианты повторяются`);
        if (q.format === QuestionFormat.MULTIPLE) {
          minChoices = q.minChoices ?? 1;
          maxChoices = q.maxChoices ?? options.length;
          if (minChoices > maxChoices || maxChoices > options.length) {
            throw new BadRequestException(`${label}: проверьте минимальное и максимальное число выбранных вариантов`);
          }
        }
        if (q.format === QuestionFormat.RANKING) {
          minChoices = options.length;
          maxChoices = options.length;
        }
      }
      return {
        position,
        text: q.text,
        format: q.format,
        minChoices,
        maxChoices,
        options: { create: options.map((text, i) => ({ position: i, text })) },
      };
    });
  }

  private async validateDraft(dto: VoteDraftDto) {
    if (dto.startsAt && new Date(dto.startsAt) >= new Date(dto.endsAt)) throw new BadRequestException('Окончание должно быть позже начала');
    if (dto.scenario === VoteScenario.ADMISSION) {
      if (!dto.subjectOrganizationId) throw new BadRequestException('Для голосования о приёме укажите кандидата');
      const org = await this.prisma.organization.findUnique({ where: { id: dto.subjectOrganizationId } });
      if (!org || org.status !== OrganizationStatus.CANDIDATE) throw new BadRequestException('Кандидат не найден или уже не в статусе кандидата');
    }
    if (dto.eligibility === VoteEligibility.LIST) {
      const ids = [...new Set(dto.organizationIds ?? [])];
      if (!ids.length) throw new BadRequestException('Выберите участников голосования');
      const members = await this.prisma.organization.count({ where: { id: { in: ids }, status: OrganizationStatus.MEMBER } });
      if (members !== ids.length) throw new BadRequestException('В список участников можно включить только членов Альянса');
    }
  }

  private async draftData(dto: VoteDraftDto) {
    return {
      title: dto.title,
      description: dto.description?.trim() || null,
      scenario: dto.scenario,
      subjectOrganizationId: dto.scenario === VoteScenario.ADMISSION ? dto.subjectOrganizationId : null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: new Date(dto.endsAt),
      quorumPercent: dto.quorumPercent ?? (await this.settings.get('votes.defaultQuorumPercent', 50)),
      eligibility: dto.eligibility,
      reminders: dto.reminderHours
        ? [...new Set(dto.reminderHours)].sort((a, b) => b - a).map((beforeHours) => ({ beforeHours }))
        : await this.settings.get('votes.defaultReminders', [{ beforeHours: 48 }, { beforeHours: 2 }]),
    };
  }

  async create(dto: VoteDraftDto, user: AuthUser, meta: RequestMeta) {
    if (!this.canManage(user)) throw new ForbiddenException('Недостаточно прав');
    await this.validateDraft(dto);
    const questions = this.normalizeQuestions(dto.questions);
    const data = await this.draftData(dto);
    return this.prisma.$transaction(async (tx) => {
      const vote = await tx.vote.create({
        data: {
          ...data,
          createdById: user.id,
          questions: { create: questions },
          eligibleVoters: dto.eligibility === VoteEligibility.LIST ? { create: [...new Set(dto.organizationIds)].map((organizationId) => ({ organizationId })) } : undefined,
        },
        include: VOTE_INCLUDE,
      });
      await this.audit.log({ actorUserId: user.id, action: 'vote.created', entityType: 'Vote', entityId: vote.id, after: vote, meta }, tx);
      return vote;
    });
  }

  async update(id: string, dto: VoteDraftDto, user: AuthUser, meta: RequestMeta) {
    const before = await this.loadForManage(id, user);
    if (before.status !== VoteStatus.DRAFT) throw new ConflictException('Изменять можно только черновик');
    await this.validateDraft(dto);
    const questions = this.normalizeQuestions(dto.questions);
    const data = await this.draftData(dto);
    return this.prisma.$transaction(async (tx) => {
      await tx.voteQuestion.deleteMany({ where: { voteId: id } });
      await tx.voteEligibleVoter.deleteMany({ where: { voteId: id } });
      const vote = await tx.vote.update({
        where: { id },
        data: {
          ...data,
          questions: { create: questions },
          eligibleVoters: dto.eligibility === VoteEligibility.LIST ? { create: [...new Set(dto.organizationIds)].map((organizationId) => ({ organizationId })) } : undefined,
        },
        include: VOTE_INCLUDE,
      });
      await this.audit.log({ actorUserId: user.id, action: 'vote.updated', entityType: 'Vote', entityId: id, before, after: vote, meta }, tx);
      return vote;
    });
  }

  // ───────────── Жизненный цикл ─────────────

  /** Состав участников фиксируется в момент публикации. */
  private async eligibleSnapshot(vote: VoteWithQuestions): Promise<string[]> {
    const notSubject = vote.subjectOrganizationId ? { id: { not: vote.subjectOrganizationId } } : {};
    if (vote.eligibility === VoteEligibility.LIST) {
      const listed = await this.prisma.voteEligibleVoter.findMany({ where: { voteId: vote.id }, select: { organizationId: true } });
      const members = await this.prisma.organization.findMany({
        where: { id: { in: listed.map((l) => l.organizationId) }, status: OrganizationStatus.MEMBER, ...notSubject },
        select: { id: true },
      });
      return members.map((m) => m.id);
    }
    const where: Prisma.OrganizationWhereInput = { status: OrganizationStatus.MEMBER, ...notSubject };
    // PAID_DUES — всегда; ALL_MEMBERS — если в настройках года включено «голосуют только оплатившие»
    if (vote.eligibility === VoteEligibility.PAID_DUES || (await this.dues.votingRequiresPaid())) {
      where.dues = { some: { year: mskYear(), status: { in: [DuesStatus.PAID, DuesStatus.WAIVED] } } };
    }
    return (await this.prisma.organization.findMany({ where, select: { id: true } })).map((o) => o.id);
  }

  async publish(id: string, user: AuthUser, meta: RequestMeta) {
    const vote = await this.loadForManage(id, user);
    if (vote.status !== VoteStatus.DRAFT) throw new ConflictException('Опубликовать можно только черновик');
    if (vote.endsAt <= new Date()) throw new BadRequestException('Срок окончания уже прошёл — измените его');
    if (!vote.questions.length) throw new BadRequestException('Добавьте вопросы');
    const orgIds = await this.eligibleSnapshot(vote);
    if (!orgIds.length) throw new BadRequestException('Нет ни одной организации, которая может участвовать в голосовании');

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.voteEligibleVoter.deleteMany({ where: { voteId: id } });
      await tx.voteEligibleVoter.createMany({ data: orgIds.map((organizationId) => ({ voteId: id, organizationId })) });
      const v = await tx.vote.update({ where: { id }, data: { status: VoteStatus.ACTIVE, startsAt: vote.startsAt ?? new Date() }, include: VOTE_INCLUDE });
      await this.audit.log({ actorUserId: user.id, action: 'vote.published', entityType: 'Vote', entityId: id, after: { status: v.status, eligibleCount: orgIds.length }, meta }, tx);
      return v;
    });
    this.notifications
      .notifyOrganizations(orgIds, {
        type: 'VOTE_STARTED',
        title: published.title,
        body: `Голосование до ${fmtMsk(published.endsAt)} (МСК)`,
        link: `/votes/${id}`,
        emailTemplate: 'VOTE_STARTED',
        vars: { endsAt: fmtMsk(published.endsAt) },
      })
      .catch((e: unknown) => this.logger.error(String(e)));
    return published;
  }

  async cast(id: string, dto: CastBallotDto, user: AuthUser, meta: RequestMeta) {
    if (!user.permissions.has(P.VOTE_CAST) || !user.organizationId) throw new ForbiddenException('Голосуют только члены Альянса');
    const vote = await this.loadVisible(id, user);
    const orgId = user.organizationId;
    const eligible = await this.prisma.voteEligibleVoter.findUnique({ where: { voteId_organizationId: { voteId: id, organizationId: orgId } } });
    if (!eligible) throw new ForbiddenException('Ваша организация не входит в список участников голосования');
    if (!this.voteOpen(vote)) throw new ConflictException('Голосование сейчас не принимает голоса');

    let rows;
    try {
      rows = validateBallot(this.questionDefs(vote), dto.answers);
    } catch (e) {
      if (e instanceof BallotError) throw new BadRequestException(e.message);
      throw e;
    }

    return this.prisma.$transaction(async (tx) => {
      // Повторная проверка статуса внутри транзакции: голосование могли закрыть параллельно
      const fresh = await tx.vote.findUniqueOrThrow({ where: { id }, select: { status: true, startsAt: true, endsAt: true } });
      if (!this.voteOpen(fresh)) throw new ConflictException('Голосование сейчас не принимает голоса');
      const previous = await tx.voteAnswer.findMany({ where: { voteId: id, organizationId: orgId }, select: { questionId: true, optionId: true, rank: true } });
      await tx.voteAnswer.deleteMany({ where: { voteId: id, organizationId: orgId } });
      const participation = await tx.voteParticipation.upsert({
        where: { voteId_organizationId: { voteId: id, organizationId: orgId } },
        create: { voteId: id, organizationId: orgId, votedByUserId: user.id },
        update: { votedByUserId: user.id, votedAt: new Date() },
      });
      await tx.voteAnswer.createMany({ data: rows.map((r) => ({ ...r, voteId: id, organizationId: orgId })) });
      await this.audit.log(
        {
          actorUserId: user.id,
          action: previous.length ? 'vote.recast' : 'vote.cast',
          entityType: 'Vote',
          entityId: id,
          before: previous.length ? { organizationId: orgId, answers: previous } : undefined,
          after: { organizationId: orgId, answers: rows },
          meta,
        },
        tx,
      );
      return { votedAt: participation.votedAt, changed: previous.length > 0 };
    });
  }

  async extend(id: string, endsAtRaw: string, user: AuthUser, meta: RequestMeta) {
    const vote = await this.loadForManage(id, user);
    if (vote.status !== VoteStatus.ACTIVE) throw new ConflictException('Продлить можно только идущее голосование');
    const endsAt = new Date(endsAtRaw);
    if (endsAt <= new Date()) throw new BadRequestException('Новый срок должен быть в будущем');
    const v = await this.prisma.vote.update({ where: { id }, data: { endsAt } });
    await this.audit.log({ actorUserId: user.id, action: 'vote.extended', entityType: 'Vote', entityId: id, before: { endsAt: vote.endsAt }, after: { endsAt }, meta });
    return v;
  }

  async cancel(id: string, user: AuthUser, meta: RequestMeta) {
    const vote = await this.loadForManage(id, user);
    if (vote.status !== VoteStatus.DRAFT && vote.status !== VoteStatus.ACTIVE) throw new ConflictException('Голосование уже завершено');
    const v = await this.prisma.vote.update({ where: { id }, data: { status: VoteStatus.CANCELLED, closedAt: new Date() } });
    await this.audit.log({ actorUserId: user.id, action: 'vote.cancelled', entityType: 'Vote', entityId: id, before: { status: vote.status }, after: { status: v.status }, meta });
    return v;
  }

  /** Подведение итогов. actor = null — автоматически по сроку. */
  async close(id: string, actor: AuthUser | null, meta?: RequestMeta) {
    const vote = actor ? await this.loadForManage(id, actor) : await this.prisma.vote.findUniqueOrThrow({ where: { id }, include: VOTE_INCLUDE });
    if (vote.status !== VoteStatus.ACTIVE) throw new ConflictException('Закрыть можно только идущее голосование');

    const live = await this.loadFull(vote);
    const closedAt = new Date();
    // Атомарно «захватываем» закрытие: параллельный вызов получит count = 0
    const claimed = await this.prisma.vote.updateMany({
      where: { id, status: VoteStatus.ACTIVE },
      data: { status: VoteStatus.CLOSED, closedAt, result: live.result as unknown as Prisma.InputJsonValue },
    });
    if (!claimed.count) throw new ConflictException('Голосование уже закрыто');
    await this.audit.log({
      actorUserId: actor?.id ?? null,
      action: actor ? 'vote.closed' : 'vote.closed_by_deadline',
      entityType: 'Vote',
      entityId: id,
      after: { quorumReached: live.result.quorumReached, participated: live.result.participatedCount, eligible: live.result.eligibleCount },
      meta,
    });

    try {
      await this.storeProtocol(await this.prisma.vote.findUniqueOrThrow({ where: { id }, include: VOTE_INCLUDE }));
    } catch (e) {
      // Протокол будет сформирован при первом скачивании
      this.logger.error(`PDF-протокол голосования ${id}: ${String(e)}`);
    }
    const closed = await this.prisma.vote.findUniqueOrThrow({ where: { id }, include: VOTE_INCLUDE });

    const summary = live.result.quorumReached
      ? live.result.questions.map((q) => q.outcome.label).join('. ')
      : 'Кворум не набран — решения не приняты.';
    const recipients = live.rows.map((r) => r.organizationId);
    if (closed.subjectOrganizationId) recipients.push(closed.subjectOrganizationId);
    this.notifications
      .notifyOrganizations(recipients, { type: 'VOTE_CLOSED', title: closed.title, body: summary, link: `/votes/${id}`, emailTemplate: 'VOTE_CLOSED' })
      .catch((e: unknown) => this.logger.error(String(e)));
    return closed;
  }

  // ───────────── Протокол, выгрузка, вложения ─────────────

  private async storeProtocol(vote: VoteWithQuestions) {
    const full = await this.loadFull(vote);
    const pdf = await buildVoteProtocolPdf(full);
    const file = await this.files.save(
      { buffer: pdf, originalname: Buffer.from(`Протокол голосования № ${vote.number}.pdf`, 'utf8').toString('latin1'), mimetype: 'application/pdf', size: pdf.length },
      null,
    );
    await this.prisma.vote.update({ where: { id: vote.id }, data: { protocolFileId: file.id } });
    return file.id;
  }

  async protocol(id: string, user: AuthUser) {
    const vote = await this.loadVisible(id, user);
    if (vote.status !== VoteStatus.CLOSED) throw new ConflictException('Протокол формируется после завершения голосования');
    const fileId = vote.protocolFileId ?? (await this.storeProtocol(vote));
    return this.files.open(fileId);
  }

  async exportCsv(id: string, user: AuthUser): Promise<{ name: string; content: Buffer }> {
    const vote = await this.loadVisible(id, user);
    if (vote.status === VoteStatus.DRAFT) throw new ConflictException('Черновик нельзя выгрузить');
    const { rows } = await this.loadFull(vote);
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const header = ['Организация', 'Регион', 'Голос подан', 'Время (МСК)', ...vote.questions.map((q, i) => `${i + 1}. ${q.text}`)];
    const lines = rows.map((r) => [
      r.organizationName,
      r.regionName,
      r.votedBy?.fullName ?? 'не голосовала',
      r.votedAt ? fmtMsk(r.votedAt) : '',
      ...vote.questions.map((q) => {
        const a = r.answers[q.id] ?? [];
        return q.format === QuestionFormat.RANKING ? a.map((x) => `${x.rank}. ${x.text}`).join('; ') : a.map((x) => x.text).join('; ');
      }),
    ]);
    const csv = [header, ...lines].map((l) => l.map(esc).join(';')).join('\r\n');
    // BOM — чтобы Excel корректно открыл кириллицу
    return { name: `golosovanie-${vote.number}.csv`, content: Buffer.from(`﻿${csv}`, 'utf8') };
  }

  private attachmentsOf(voteId: string) {
    return this.prisma.fileLink
      .findMany({
        where: { entityType: FileEntityType.VOTE, entityId: voteId },
        include: { file: { select: { id: true, originalName: true, mime: true, size: true, createdAt: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((links) => links.map((l) => l.file));
  }

  async addAttachment(id: string, file: UploadedFileLike | undefined, user: AuthUser, meta: RequestMeta) {
    const vote = await this.loadForManage(id, user);
    if (vote.status !== VoteStatus.DRAFT) throw new ConflictException('Документы прикладываются до публикации: участники должны голосовать по неизменному тексту');
    if (!file) throw new BadRequestException('Файл не передан');
    const saved = await this.files.save(file, user.id, { maxBytes: 20 * 1024 * 1024 });
    await this.prisma.fileLink.create({ data: { fileId: saved.id, entityType: FileEntityType.VOTE, entityId: id, docType: 'ATTACHMENT' } });
    await this.audit.log({ actorUserId: user.id, action: 'vote.attachment_added', entityType: 'Vote', entityId: id, after: { fileId: saved.id, name: saved.originalName, sha256: saved.sha256 }, meta });
    return { id: saved.id, originalName: saved.originalName, mime: saved.mime, size: saved.size, createdAt: saved.createdAt };
  }

  async removeAttachment(id: string, fileId: string, user: AuthUser, meta: RequestMeta) {
    const vote = await this.loadForManage(id, user);
    if (vote.status !== VoteStatus.DRAFT) throw new ConflictException('Документы можно убрать только из черновика');
    const res = await this.prisma.fileLink.deleteMany({ where: { fileId, entityType: FileEntityType.VOTE, entityId: id } });
    if (!res.count) throw new NotFoundException('Файл не найден');
    await this.audit.log({ actorUserId: user.id, action: 'vote.attachment_removed', entityType: 'Vote', entityId: id, before: { fileId }, meta });
  }

  async openAttachment(id: string, fileId: string, user: AuthUser) {
    await this.loadVisible(id, user);
    const link = await this.prisma.fileLink.findFirst({ where: { fileId, entityType: FileEntityType.VOTE, entityId: id } });
    if (!link) throw new NotFoundException('Файл не найден');
    return this.files.open(fileId);
  }
}

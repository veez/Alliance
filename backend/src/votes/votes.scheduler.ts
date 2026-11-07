import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { VoteStatus } from '@prisma/client';
import { fmtMsk } from '../common/time';
import { env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { VotesService } from './votes.service';

const TICK_MS = 60_000;

/**
 * Раз в минуту: закрывает голосования с истёкшим сроком и рассылает напоминания.
 * Рассчитан на один экземпляр API; повторное закрытие и повторные напоминания
 * исключены атомарным «захватом» закрытия и уникальным индексом vote_reminder_log.
 */
@Injectable()
export class VotesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('VotesScheduler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly votes: VotesService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (env.isTest) return; // в тестах методы вызываются напрямую
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.closeExpired(now);
      await this.sendReminders(now);
    } catch (e) {
      this.logger.error(String(e));
    } finally {
      this.running = false;
    }
  }

  async closeExpired(now = new Date()): Promise<number> {
    const expired = await this.prisma.vote.findMany({ where: { status: VoteStatus.ACTIVE, endsAt: { lte: now } }, select: { id: true, number: true } });
    let closed = 0;
    for (const v of expired) {
      try {
        await this.votes.close(v.id, null);
        closed++;
        this.logger.log(`Голосование № ${v.number} закрыто по сроку`);
      } catch (e) {
        this.logger.warn(`Голосование № ${v.number}: ${String(e)}`);
      }
    }
    return closed;
  }

  async sendReminders(now = new Date()): Promise<number> {
    const active = await this.prisma.vote.findMany({
      where: { status: VoteStatus.ACTIVE, endsAt: { gt: now } },
      select: { id: true, title: true, startsAt: true, endsAt: true, reminders: true },
    });
    let sent = 0;
    for (const v of active) {
      const reminders = (v.reminders as Array<{ beforeHours: number }> | null) ?? [];
      for (const { beforeHours } of reminders) {
        const at = new Date(v.endsAt.getTime() - beforeHours * 3_600_000);
        // Пропускаем напоминания, чей момент наступил до начала голосования
        if (now < at || (v.startsAt && at < v.startsAt)) continue;
        const kind = `before_${beforeHours}h`;
        const [eligible, voted, logged] = await Promise.all([
          this.prisma.voteEligibleVoter.findMany({ where: { voteId: v.id }, select: { organizationId: true } }),
          this.prisma.voteParticipation.findMany({ where: { voteId: v.id }, select: { organizationId: true } }),
          this.prisma.voteReminderLog.findMany({ where: { voteId: v.id, kind }, select: { organizationId: true } }),
        ]);
        const skip = new Set([...voted, ...logged].map((x) => x.organizationId));
        const targets = eligible.map((e) => e.organizationId).filter((id) => !skip.has(id));
        if (!targets.length) continue;
        await this.prisma.voteReminderLog.createMany({ data: targets.map((organizationId) => ({ voteId: v.id, organizationId, kind })), skipDuplicates: true });
        await this.notifications.notifyOrganizations(targets, {
          type: 'VOTE_REMINDER',
          title: v.title,
          body: `Голосование завершится ${fmtMsk(v.endsAt)} (МСК)`,
          link: `/votes/${v.id}`,
          emailTemplate: 'VOTE_REMINDER',
          vars: { endsAt: fmtMsk(v.endsAt) },
        });
        sent += targets.length;
      }
    }
    return sent;
  }
}

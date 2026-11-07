import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { env } from '../config/env';
import { DuesService } from './dues.service';

const TICK_MS = 60 * 60_000;

/** Раз в час: просрочка по сроку и плановые напоминания должникам (каждое — не более одного раза). */
@Injectable()
export class DuesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DuesScheduler');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly dues: DuesService) {}

  onModuleInit() {
    if (env.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    try {
      const overdue = await this.dues.recomputeOpen(now);
      const sent = await this.dues.sendScheduledReminders(now);
      if (overdue || sent) this.logger.log(`Статусов обновлено: ${overdue}, напоминаний отправлено: ${sent}`);
    } catch (e) {
      this.logger.error(String(e));
    }
  }
}

import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationPayload {
  type: string;
  title: string;
  body?: string;
  /** Путь внутри портала, например /votes/<id> */
  link?: string;
  /** Шаблон письма (email_templates.code); переменные title/body/link/fullName подставляются автоматически */
  emailTemplate?: string;
  vars?: Record<string, string>;
}

/**
 * Уведомления: запись в ленту (таблица notifications, интерфейс — этап 7) + письмо по шаблону.
 * Отправка писем не блокирует запрос: ошибки пишутся в лог.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async notifyOrganizations(organizationIds: string[], payload: NotificationPayload): Promise<number> {
    if (!organizationIds.length) return 0;
    const users = await this.prisma.user.findMany({
      where: { organizationId: { in: organizationIds }, status: UserStatus.ACTIVE },
      select: { id: true, email: true, fullName: true },
    });
    await this.notifyUsers(users, payload);
    return users.length;
  }

  async notifyUsers(users: Array<{ id: string; email: string; fullName: string }>, payload: NotificationPayload): Promise<void> {
    if (!users.length) return;
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId: { in: users.map((u) => u.id) }, type: payload.type },
      select: { userId: true, inApp: true, email: true },
    });
    const noInApp = new Set(prefs.filter((p) => !p.inApp).map((p) => p.userId));
    await this.prisma.notification.createMany({
      data: users
        .filter((u) => !noInApp.has(u.id))
        .map((u) => ({ userId: u.id, type: payload.type, title: payload.title, body: payload.body, link: payload.link })),
    });
    if (!payload.emailTemplate) return;
    const optedOut = new Set(prefs.filter((p) => !p.email).map((p) => p.userId));
    for (const u of users) {
      if (optedOut.has(u.id)) continue;
      this.mail
        .sendTemplate(payload.emailTemplate, u.email, {
          fullName: u.fullName,
          title: payload.title,
          body: payload.body ?? '',
          link: payload.link ? `${env.appUrl}${payload.link}` : env.appUrl,
          ...payload.vars,
        })
        .catch((e: unknown) => this.logger.error(`Письмо ${payload.emailTemplate} → ${u.email}: ${String(e)}`));
    }
  }
}

@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}

import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { AllowMfaPending, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/auth-user';
import { pageArgs, PageQuery } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

/** Типы уведомлений, которые пользователь может настраивать. hasEmail — есть ли письмо у этого типа. */
export const NOTIFICATION_TYPES: Record<string, { label: string; group: string; hasEmail: boolean }> = {
  VOTE_STARTED: { label: 'Начато голосование', group: 'Голосования', hasEmail: true },
  VOTE_REMINDER: { label: 'Напоминание о голосовании', group: 'Голосования', hasEmail: true },
  VOTE_CLOSED: { label: 'Итоги голосования', group: 'Голосования', hasEmail: true },
  DUES_REMINDER: { label: 'Напоминание о взносе', group: 'Взносы', hasEmail: true },
  EVENT_INVITE: { label: 'Приглашение на мероприятие', group: 'Мероприятия', hasEmail: true },
  EVENT_REMINDER: { label: 'Напоминание о мероприятии', group: 'Мероприятия', hasEmail: true },
  EVENT_CANCELLED: { label: 'Отмена мероприятия', group: 'Мероприятия', hasEmail: true },
  PROTOCOL_PUBLISHED: { label: 'Опубликован протокол', group: 'Мероприятия', hasEmail: false },
  WG_TASK_ASSIGNED: { label: 'Мне поручена задача', group: 'Рабочие группы', hasEmail: false },
  WG_COMMENT: { label: 'Комментарий к задаче', group: 'Рабочие группы', hasEmail: false },
  WG_MEMBER_ADDED: { label: 'Меня добавили в группу', group: 'Рабочие группы', hasEmail: false },
  WG_MEMBER_JOINED: { label: 'Новый участник моей группы', group: 'Рабочие группы', hasEmail: false },
};

class NotificationListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() unread?: boolean;
}

class PreferenceItem {
  @ApiProperty() @IsIn(Object.keys(NOTIFICATION_TYPES)) type: string;
  @ApiProperty() @IsBoolean() inApp: boolean;
  @ApiProperty() @IsBoolean() email: boolean;
}
class PreferencesDto {
  @ApiProperty({ type: [PreferenceItem] }) @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => PreferenceItem) items: PreferenceItem[];
}

@ApiTags('Уведомления')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: NotificationListQuery, @CurrentUser() u: AuthUser) {
    const where = { userId: u.id, readAt: q.unread ? null : undefined };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: u.id, readAt: null } }),
    ]);
    return { items, total, unread, page: q.page, pageSize: q.pageSize };
  }

  @Get('unread-count')
  @AllowMfaPending()
  @ApiOperation({ summary: 'Число непрочитанных (для колокольчика)' })
  async unreadCount(@CurrentUser() u: AuthUser) {
    return { count: await this.prisma.notification.count({ where: { userId: u.id, readAt: null } }) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId: u.id, readAt: null }, data: { readAt: new Date() } });
    if (!res.count && !(await this.prisma.notification.findFirst({ where: { id, userId: u.id } }))) throw new NotFoundException('Уведомление не найдено');
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) {
    const res = await this.prisma.notification.updateMany({ where: { userId: u.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  @Get('preferences')
  async preferences(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId: u.id } });
    return Object.entries(NOTIFICATION_TYPES).map(([type, meta]) => {
      const r = rows.find((x) => x.type === type);
      return { type, label: meta.label, group: meta.group, emailAvailable: meta.hasEmail, inApp: r?.inApp ?? true, email: meta.hasEmail ? (r?.email ?? true) : false };
    });
  }

  @Put('preferences')
  async savePreferences(@Body() dto: PreferencesDto, @CurrentUser() u: AuthUser) {
    await this.prisma.$transaction(
      dto.items.map((i) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_type: { userId: u.id, type: i.type } },
          update: { inApp: i.inApp, email: i.email },
          create: { userId: u.id, type: i.type, inApp: i.inApp, email: i.email },
        }),
      ),
    );
    return this.preferences(u);
  }
}

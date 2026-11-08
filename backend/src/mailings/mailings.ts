/** Рассылки по группам без привязки к мероприятию. */
import { BadRequestException, Body, Controller, Get, Injectable, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { EventAudience, OrganizationStatus, Prisma, UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import { Page, pageArgs, PageQuery } from '../common/pagination';
import { env } from '../config/env';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class MailingDto {
  @ApiProperty({ enum: EventAudience }) @IsEnum(EventAudience) audience: EventAudience;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(200) subject: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(20_000) body: string;
}

export class RecipientsQuery {
  @ApiProperty({ enum: EventAudience }) @IsEnum(EventAudience) audience: EventAudience;
}

@Injectable()
export class MailingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Получатели — только принявшие приглашение. */
  private recipients(audience: EventAudience) {
    const group: Prisma.UserWhereInput =
      audience === EventAudience.BOARD
        ? { wgMemberships: { some: { workingGroup: { isBoard: true } } } }
        : { organization: { status: audience === EventAudience.CANDIDATES ? OrganizationStatus.CANDIDATE : OrganizationStatus.MEMBER, isDemo: false } };
    return this.prisma.user.findMany({ where: { status: UserStatus.ACTIVE, isDemo: false, ...group }, select: { id: true, email: true, fullName: true } });
  }

  async count(audience: EventAudience) {
    return { count: (await this.recipients(audience)).length, emailEnabled: !!env.smtp.host };
  }

  async list(q: PageQuery): Promise<Page<unknown>> {
    const [items, total] = await Promise.all([
      this.prisma.mailing.findMany({ orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { id: true, fullName: true } } }, ...pageArgs(q) }),
      this.prisma.mailing.count(),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async send(dto: MailingDto, actor: AuthUser, meta: RequestMeta) {
    const users = await this.recipients(dto.audience);
    if (!users.length) throw new BadRequestException('В этой группе пока нет получателей: никто не принял приглашение в портал');
    const mailing = await this.prisma.mailing.create({ data: { ...dto, recipients: users.length, createdById: actor.id } });
    await this.audit.log({ actorUserId: actor.id, action: 'mailing.sent', entityType: 'Mailing', entityId: mailing.id, after: { audience: dto.audience, subject: dto.subject, recipients: users.length }, meta });
    await this.notifications.notifyUsers(users, { type: 'MAILING', title: dto.subject, body: dto.body, emailTemplate: 'MAILING' });
    return mailing;
  }
}

@ApiTags('Рассылки')
@ApiBearerAuth()
@Controller('mailings')
@RequirePermissions(P.MAILINGS_SEND)
export class MailingsController {
  constructor(private readonly mailings: MailingsService) {}

  @Get()
  list(@Query() q: PageQuery) {
    return this.mailings.list(q);
  }

  @Get('recipients')
  @ApiOperation({ summary: 'Сколько человек получит рассылку' })
  recipients(@Query() q: RecipientsQuery) {
    return this.mailings.count(q.audience);
  }

  @Post()
  send(@Body() dto: MailingDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.mailings.send(dto, u, meta);
  }
}

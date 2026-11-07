import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import { DEFAULT_TEMPLATES, renderTemplate } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

const uniqSortedDesc = ({ value }: { value: unknown }) => (Array.isArray(value) ? [...new Set(value.map(Number))].sort((a, b) => b - a) : value);

export class PortalSettingsDto {
  @ApiProperty({ description: 'Кворум по умолчанию для новых голосований, %' }) @IsInt() @Min(1) @Max(100) defaultQuorumPercent: number;
  @ApiProperty({ description: 'Напоминания о голосовании по умолчанию: за сколько часов до окончания', example: [48, 2] })
  @Transform(uniqSortedDesc)
  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(720, { each: true })
  voteReminderHours: number[];
  @ApiProperty({ description: 'Напоминания о взносе: за сколько дней до срока', example: [30, 7] })
  @Transform(uniqSortedDesc)
  @IsArray()
  @ArrayMaxSize(5)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(180, { each: true })
  duesReminderDaysBefore: number[];
}

export class EmailTemplateDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300) subject: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(50_000) bodyHtml: string;
}

/** Переменные, доступные в шаблоне: всё, что встречается в шаблоне по умолчанию, + общие. */
function templateVars(code: string): string[] {
  const d = DEFAULT_TEMPLATES[code];
  const found = new Set(['fullName', 'title', 'body', 'link']);
  for (const m of `${d?.subject ?? ''} ${d?.bodyHtml ?? ''}`.matchAll(/\{\{(\w+)\}\}/g)) found.add(m[1]);
  return [...found];
}

const SAMPLE: Record<string, string> = {
  fullName: 'Иванова Мария Сергеевна',
  title: 'Утверждение плана работы на 2027 год',
  body: 'Текст уведомления',
  link: 'https://portal.example/votes/1',
  endsAt: '15.12.2026 18:00',
  expiresAt: '15.12.2026 18:00',
  when: '12.12.2026 11:00',
  format: 'очно и онлайн',
  where: 'Москва, ул. Тверская, 7',
  amount: '30 000 ₽',
  dueDate: '31.03.2027',
  year: '2027',
  organization: 'Центр «Опора»',
};

@ApiTags('Администрирование')
@ApiBearerAuth()
@Controller('admin')
@RequirePermissions(P.SETTINGS_MANAGE)
export class AdminSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private async current(): Promise<PortalSettingsDto> {
    return {
      defaultQuorumPercent: await this.settings.get('votes.defaultQuorumPercent', 50),
      voteReminderHours: (await this.settings.get<Array<{ beforeHours: number }>>('votes.defaultReminders', [{ beforeHours: 48 }, { beforeHours: 2 }])).map((r) => r.beforeHours),
      duesReminderDaysBefore: await this.settings.get('dues.reminderDaysBefore', [30, 7]),
    };
  }

  @Get('settings')
  settingsGet() {
    return this.current();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Настройки по умолчанию: кворум, напоминания' })
  async settingsPut(@Body() dto: PortalSettingsDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    const before = await this.current();
    await this.settings.set('votes.defaultQuorumPercent', dto.defaultQuorumPercent);
    await this.settings.set(
      'votes.defaultReminders',
      dto.voteReminderHours.map((beforeHours) => ({ beforeHours })),
    );
    await this.settings.set('dues.reminderDaysBefore', dto.duesReminderDaysBefore);
    const after = await this.current();
    await this.audit.log({ actorUserId: u.id, action: 'settings.updated', entityType: 'Settings', before, after, meta });
    return after;
  }

  @Get('email-templates')
  async templates() {
    const rows = await this.prisma.emailTemplate.findMany({ include: { updatedBy: { select: { id: true, fullName: true } } } });
    return Object.entries(DEFAULT_TEMPLATES).map(([code, d]) => {
      const r = rows.find((x) => x.code === code);
      return {
        code,
        name: d.name,
        subject: r?.subject ?? d.subject,
        bodyHtml: r?.bodyHtml ?? d.bodyHtml,
        isDefault: !r || (r.subject === d.subject && r.bodyHtml === d.bodyHtml),
        updatedAt: r?.updatedAt ?? null,
        updatedBy: r?.updatedById ? r.updatedBy : null,
        variables: templateVars(code),
      };
    });
  }

  @Put('email-templates/:code')
  async saveTemplate(@Param('code') code: string, @Body() dto: EmailTemplateDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    const d = DEFAULT_TEMPLATES[code];
    if (!d) throw new NotFoundException('Шаблон не найден');
    const before = await this.prisma.emailTemplate.findUnique({ where: { code } });
    await this.prisma.emailTemplate.upsert({
      where: { code },
      update: { subject: dto.subject, bodyHtml: dto.bodyHtml, updatedById: u.id },
      create: { code, name: d.name, subject: dto.subject, bodyHtml: dto.bodyHtml, updatedById: u.id },
    });
    await this.audit.log({
      actorUserId: u.id,
      action: 'email_template.updated',
      entityType: 'EmailTemplate',
      before: before ? { code, subject: before.subject, bodyHtml: before.bodyHtml } : { code },
      after: { code, subject: dto.subject, bodyHtml: dto.bodyHtml },
      meta,
    });
    return (await this.templates()).find((t) => t.code === code);
  }

  @Post('email-templates/:code/reset')
  @HttpCode(200)
  async resetTemplate(@Param('code') code: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    const d = DEFAULT_TEMPLATES[code];
    if (!d) throw new NotFoundException('Шаблон не найден');
    return this.saveTemplate(code, { subject: d.subject, bodyHtml: d.bodyHtml }, u, meta);
  }

  @Post('email-templates/:code/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Предпросмотр письма с примерными данными' })
  preview(@Param('code') code: string, @Body() dto: EmailTemplateDto) {
    if (!DEFAULT_TEMPLATES[code]) throw new NotFoundException('Шаблон не найден');
    return { subject: renderTemplate(dto.subject, SAMPLE, false), html: renderTemplate(dto.bodyHtml, SAMPLE) };
  }
}

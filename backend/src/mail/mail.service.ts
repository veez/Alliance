import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Стандартные шаблоны. Админ может переопределить их в таблице email_templates. */
export const DEFAULT_TEMPLATES: Record<string, { name: string; subject: string; bodyHtml: string }> = {
  INVITATION: {
    name: 'Приглашение в портал',
    subject: 'Приглашение в портал Альянса «Ценность каждого»',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>Вас пригласили в служебный портал Альянса «Ценность каждого».</p>' +
      '<p><a href="{{link}}">Принять приглашение и задать пароль</a></p><p>Ссылка действует до {{expiresAt}}.</p>',
  },
  PASSWORD_RESET: {
    name: 'Сброс пароля',
    subject: 'Сброс пароля — портал Альянса',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>Чтобы задать новый пароль, перейдите по ссылке: <a href="{{link}}">{{link}}</a></p>' +
      '<p>Ссылка действует 1 час. Если вы не запрашивали сброс, просто проигнорируйте письмо.</p>',
  },
  VOTE_STARTED: {
    name: 'Новое голосование',
    subject: 'Новое голосование: {{title}}',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>В портале Альянса открыто голосование <b>«{{title}}»</b>.</p>' +
      '<p>Голосование продлится до {{endsAt}} (МСК). От организации учитывается один голос.</p><p><a href="{{link}}">Перейти к голосованию</a></p>',
  },
  VOTE_REMINDER: {
    name: 'Напоминание о голосовании',
    subject: 'Напоминание: голосование «{{title}}» завершится {{endsAt}}',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>Ваша организация ещё не проголосовала в голосовании <b>«{{title}}»</b>.</p>' +
      '<p>Голосование завершится {{endsAt}} (МСК).</p><p><a href="{{link}}">Проголосовать</a></p>',
  },
  DUES_REMINDER: {
    name: 'Напоминание о членском взносе',
    subject: 'Членский взнос за {{year}} год — {{state}}',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>Напоминаем о ежегодном членском взносе организации <b>{{organization}}</b> в Альянс «Ценность каждого» за {{year}} год.</p>' +
      '<p>Начислено: {{amountDue}} ₽. Оплачено: {{paid}} ₽. <b>К оплате: {{debt}} ₽</b>.<br>Срок оплаты: {{dueDate}}.</p>' +
      '<p>Если взнос уже оплачен, приложите платёжное поручение в личном кабинете — секретарь отметит оплату.</p><p><a href="{{link}}">Мои взносы</a></p>',
  },
  EVENT_INVITE: {
    name: 'Приглашение на мероприятие',
    subject: 'Приглашение: {{title}} — {{when}}',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>Приглашаем на мероприятие Альянса <b>«{{title}}»</b>.</p>' +
      '<p>Когда: {{when}} (МСК)<br>Формат: {{format}}{{where}}</p><p>Пожалуйста, подтвердите участие в портале: <a href="{{link}}">{{link}}</a></p>',
  },
  EVENT_REMINDER: {
    name: 'Напоминание о мероприятии',
    subject: 'Завтра: {{title}}',
    bodyHtml: '<p>Здравствуйте, {{fullName}}!</p><p>Напоминаем: <b>«{{title}}»</b> — {{when}} (МСК).</p><p>{{where}}</p><p><a href="{{link}}">Подробности</a></p>',
  },
  EVENT_CANCELLED: {
    name: 'Мероприятие отменено',
    subject: 'Отменено: {{title}}',
    bodyHtml: '<p>Здравствуйте, {{fullName}}!</p><p>Мероприятие <b>«{{title}}»</b>, назначенное на {{when}} (МСК), отменено.</p><p><a href="{{link}}">Подробности</a></p>',
  },
  MAILING: {
    name: 'Рассылка',
    subject: '{{title}}',
    bodyHtml: '<p>Здравствуйте, {{fullName}}!</p><div style="white-space: pre-line">{{body}}</div><p><a href="{{link}}">Перейти в портал Альянса</a></p>',
  },
  VOTE_CLOSED: {
    name: 'Итоги голосования',
    subject: 'Итоги голосования: {{title}}',
    bodyHtml:
      '<p>Здравствуйте, {{fullName}}!</p><p>Голосование <b>«{{title}}»</b> завершено.</p><p>{{body}}</p>' +
      '<p><a href="{{link}}">Посмотреть итоги и протокол</a></p>',
  },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderTemplate(tpl: string, vars: Record<string, string>, html = true): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k] ?? '';
    return html ? escapeHtml(v) : v;
  });
}

@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly transport: Transporter | null;
  private readonly outDir = resolve(process.cwd(), 'var', 'mail');

  constructor(private readonly prisma: PrismaService) {
    this.transport = env.smtp.host
      ? nodemailer.createTransport({
          host: env.smtp.host,
          port: env.smtp.port,
          secure: env.smtp.port === 465,
          auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
        })
      : null;
  }

  async sendTemplate(code: string, to: string, vars: Record<string, string>): Promise<void> {
    const custom = await this.prisma.emailTemplate.findUnique({ where: { code } });
    const tpl = custom ?? DEFAULT_TEMPLATES[code];
    if (!tpl) throw new Error(`Нет шаблона письма ${code}`);
    await this.send(to, renderTemplate(tpl.subject, vars, false), renderTemplate(tpl.bodyHtml, vars));
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (this.transport) {
      await this.transport.sendMail({ from: env.smtp.from, to, subject, html });
      this.logger.log(`Отправлено письмо «${subject}» → ${to}`);
      return;
    }
    if (env.isTest) return;
    // Режим разработки: сохраняем письмо в var/mail/*.eml
    mkdirSync(this.outDir, { recursive: true });
    const file = join(this.outDir, `${Date.now()}-${to.replace(/[^\w.@-]/g, '_')}.eml`);
    const eml = [
      `From: ${env.smtp.from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      html,
    ].join('\r\n');
    writeFileSync(file, eml, 'utf8');
    this.logger.log(`[dev] Письмо «${subject}» → ${to} сохранено в ${file}`);
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}

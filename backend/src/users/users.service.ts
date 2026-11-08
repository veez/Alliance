import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SystemRole, UserStatus } from '@prisma/client';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../auth/crypto';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { Page, pageArgs } from '../common/pagination';
import { env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { InviteUserDto, UpdateProfileDto, UpdateUserDto, UserListQuery } from './users.dto';

const INVITE_TTL_MS = 7 * 86_400_000;

/** Поля пользователя, безопасные для выдачи (без хэшей и секретов). */
export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  position: true,
  systemRole: true,
  canViewAll: true,
  status: true,
  organizationId: true,
  totpEnabledAt: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true, shortName: true, status: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(q: UserListQuery): Promise<Page<unknown>> {
    const where: Prisma.UserWhereInput = {
      NOT: { isDemo: true, status: 'BLOCKED' }, // обезличенные демо-учётки
      systemRole: q.systemRole,
      status: q.status,
      organizationId: q.organizationId,
      OR: q.search
        ? [
            { fullName: { contains: q.search, mode: 'insensitive' } },
            { email: { contains: q.search, mode: 'insensitive' } },
            { organization: { name: { contains: q.search, mode: 'insensitive' } } },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: USER_PUBLIC_SELECT, orderBy: { fullName: 'asc' }, ...pageArgs(q) }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }

  /** Приглашать с повышенной ролью может только тот, кто управляет ролями. */
  private assertCanGrant(role: SystemRole, actor: AuthUser) {
    if (role !== SystemRole.USER && !actor.permissions.has(P.ROLES_MANAGE)) throw new ForbiddenException('Пригласить с этой ролью может только администратор');
  }

  async invite(dto: InviteUserDto, actor: AuthUser, meta: RequestMeta) {
    this.assertCanGrant(dto.systemRole ?? SystemRole.USER, actor);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ConflictException('Пользователь с таким email уже есть');
    }
    if (dto.organizationId) await this.assertOrganization(dto.organizationId);

    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: dto.email,
          fullName: dto.fullName,
          position: dto.position,
          phone: dto.phone,
          systemRole: dto.systemRole ?? SystemRole.USER,
          organizationId: dto.organizationId,
          status: UserStatus.INVITED,
        },
        select: USER_PUBLIC_SELECT,
      });
      await tx.invitation.create({
        data: {
          email: u.email,
          tokenHash: sha256(token),
          tokenEnc: encryptSecret(token),
          userId: u.id,
          systemRole: u.systemRole,
          organizationId: u.organizationId,
          createdById: actor.id,
          expiresAt,
        },
      });
      await this.audit.log({ actorUserId: actor.id, action: 'user.invited', entityType: 'User', entityId: u.id, after: u, meta }, tx);
      return u;
    });

    return { user, expiresAt, ...(await this.sendInvitation(user.email, user.fullName, token, expiresAt)) };
  }

  async resendInvitation(id: string, actor: AuthUser, meta: RequestMeta) {
    const user = await this.get(id);
    if (user.status !== UserStatus.INVITED) throw new BadRequestException('Пользователь уже активировал учётную запись');
    this.assertCanGrant(user.systemRole, actor);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Старые ссылки перестают действовать
      await tx.invitation.updateMany({ where: { userId: id, usedAt: null }, data: { expiresAt: new Date(), tokenEnc: null } });
      await tx.invitation.create({
        data: {
          email: user.email,
          tokenHash: sha256(token),
          tokenEnc: encryptSecret(token),
          userId: id,
          systemRole: user.systemRole,
          organizationId: user.organizationId,
          createdById: actor.id,
          expiresAt,
        },
      });
      await this.audit.log({ actorUserId: actor.id, action: 'user.invitation_resent', entityType: 'User', entityId: id, meta }, tx);
    });
    return { expiresAt, ...(await this.sendInvitation(user.email, user.fullName, token, expiresAt)) };
  }

  /**
   * Действующая ссылка-приглашение: при повторном запросе та же, чтобы уже отправленная не сломалась.
   * Новая создаётся, только если ссылки ещё нет или срок истёк. Письмо не отправляется.
   */
  async inviteLink(id: string, actor: AuthUser, meta: RequestMeta) {
    const user = await this.get(id);
    if (user.status !== UserStatus.INVITED) throw new BadRequestException('Пользователь уже принял приглашение');
    this.assertCanGrant(user.systemRole, actor);
    const open = await this.prisma.invitation.findFirst({ where: { userId: id, usedAt: null, expiresAt: { gt: new Date() }, tokenEnc: { not: null } }, orderBy: { createdAt: 'desc' } });
    let token: string;
    let expiresAt: Date;
    if (open) {
      token = decryptSecret(open.tokenEnc!);
      expiresAt = open.expiresAt;
    } else {
      token = randomToken();
      expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      await this.prisma.$transaction(async (tx) => {
        await tx.invitation.updateMany({ where: { userId: id, usedAt: null }, data: { expiresAt: new Date(), tokenEnc: null } });
        await tx.invitation.create({ data: { email: user.email, tokenHash: sha256(token), tokenEnc: encryptSecret(token), userId: id, systemRole: user.systemRole, organizationId: user.organizationId, createdById: actor.id, expiresAt } });
      });
    }
    await this.audit.log({ actorUserId: actor.id, action: 'user.invite_link_viewed', entityType: 'User', entityId: id, meta });
    return { inviteLink: `${env.appUrl}/invite?token=${token}`, emailSent: false, expiresAt };
  }

  /** Приглашение сотрудника организации: создаёт учётку или выдаёт новую ссылку, если он ещё не вошёл. */
  async inviteEmployee(organizationId: string, employeeId: string, actor: AuthUser, meta: RequestMeta) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { user: { select: { id: true, status: true } } } });
    if (!employee) throw new NotFoundException('Сотрудник не найден');
    if (employee.user) {
      if (employee.user.status !== UserStatus.INVITED) throw new ConflictException('Сотрудник уже принял приглашение');
      return this.inviteLink(employee.user.id, actor, meta);
    }
    if (!employee.email) throw new BadRequestException('Укажите почту сотрудника: она будет логином');
    const email = employee.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      const linked = await this.prisma.employee.findUnique({ where: { userId: existing.id }, select: { id: true } });
      if (existing.organizationId !== organizationId || existing.status !== UserStatus.INVITED || linked) throw new ConflictException('Эта почта уже используется другой учётной записью');
      await this.prisma.employee.update({ where: { id: employeeId }, data: { userId: existing.id } });
      return this.inviteLink(existing.id, actor, meta);
    }
    const result = await this.invite({ email, fullName: employee.fullName, position: employee.position ?? undefined, phone: employee.phone ?? undefined, organizationId } as InviteUserDto, actor, meta);
    await this.prisma.employee.update({ where: { id: employeeId }, data: { userId: result.user.id } });
    return result;
  }

  /** Ссылка возвращается всегда: её можно передать любым способом; ошибка почты приглашение не отменяет. */
  private async sendInvitation(email: string, fullName: string, token: string, expiresAt: Date) {
    const inviteLink = `${env.appUrl}/invite?token=${token}`;
    let emailSent = !!env.smtp.host;
    try {
      await this.mail.sendTemplate('INVITATION', email, {
        fullName,
        link: inviteLink,
        expiresAt: expiresAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
      });
    } catch (e) {
      emailSent = false;
      new Logger('Users').error(`Письмо-приглашение не отправлено: ${String(e)}`);
    }
    return { inviteLink, emailSent };
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get(id);
    if (dto.organizationId) await this.assertOrganization(dto.organizationId);

    const losesAdmin =
      before.systemRole === SystemRole.ADMIN &&
      ((dto.systemRole !== undefined && dto.systemRole !== SystemRole.ADMIN) || dto.status === UserStatus.BLOCKED);
    if (losesAdmin) {
      const admins = await this.prisma.user.count({ where: { systemRole: SystemRole.ADMIN, status: UserStatus.ACTIVE, id: { not: id } } });
      if (admins === 0) throw new BadRequestException('Нельзя лишить прав последнего активного администратора');
    }
    if (dto.status && before.status === UserStatus.INVITED) {
      if (dto.status === UserStatus.ACTIVE) throw new BadRequestException('Пользователь активируется сам, приняв приглашение');
    }

    const roleChanged = dto.systemRole !== undefined && dto.systemRole !== before.systemRole;
    const after = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: {
          fullName: dto.fullName,
          position: dto.position,
          phone: dto.phone,
          systemRole: dto.systemRole,
          canViewAll: dto.canViewAll,
          organizationId: dto.organizationId,
          status: dto.status,
          // При понижении роли 2FA остаётся включённой; при повышении — потребуется настройка, если не включена.
        },
        select: USER_PUBLIC_SELECT,
      });
      if (dto.status === UserStatus.BLOCKED || roleChanged) {
        await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log({ actorUserId: actor.id, action: 'user.updated', entityType: 'User', entityId: id, before, after: u, meta }, tx);
      return u;
    });
    return after;
  }

  async reset2fa(id: string, actor: AuthUser, meta: RequestMeta) {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { totpEnabledAt: null, totpSecretEnc: null } });
      await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorUserId: actor.id, action: 'user.2fa_reset', entityType: 'User', entityId: id, meta }, tx);
    });
  }

  async unlock(id: string, actor: AuthUser, meta: RequestMeta) {
    await this.get(id);
    await this.prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLogins: 0 } });
    await this.audit.log({ actorUserId: actor.id, action: 'user.unlocked', entityType: 'User', entityId: id, meta });
  }

  async updateProfile(actor: AuthUser, dto: UpdateProfileDto, meta: RequestMeta) {
    const before = await this.get(actor.id);
    const after = await this.prisma.user.update({
      where: { id: actor.id },
      data: { fullName: dto.fullName, position: dto.position, phone: dto.phone },
      select: USER_PUBLIC_SELECT,
    });
    await this.audit.log({ actorUserId: actor.id, action: 'user.profile_updated', entityType: 'User', entityId: actor.id, before, after, meta });
    return after;
  }

  private async assertOrganization(id: string) {
    if (!(await this.prisma.organization.findUnique({ where: { id }, select: { id: true } }))) {
      throw new BadRequestException('Организация не найдена');
    }
  }
}

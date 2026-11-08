import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SystemRole, UserStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../auth/crypto';
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

  async invite(dto: InviteUserDto, actor: AuthUser, meta: RequestMeta) {
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

    const inviteLink = await this.sendInvitation(user.email, user.fullName, token, expiresAt);
    return { user, inviteLink, expiresAt };
  }

  async resendInvitation(id: string, actor: AuthUser, meta: RequestMeta) {
    const user = await this.get(id);
    if (user.status !== UserStatus.INVITED) throw new BadRequestException('Пользователь уже активировал учётную запись');
    const token = randomToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Старые ссылки перестают действовать
      await tx.invitation.updateMany({ where: { userId: id, usedAt: null }, data: { expiresAt: new Date() } });
      await tx.invitation.create({
        data: {
          email: user.email,
          tokenHash: sha256(token),
          userId: id,
          systemRole: user.systemRole,
          organizationId: user.organizationId,
          createdById: actor.id,
          expiresAt,
        },
      });
      await this.audit.log({ actorUserId: actor.id, action: 'user.invitation_resent', entityType: 'User', entityId: id, meta }, tx);
    });
    const inviteLink = await this.sendInvitation(user.email, user.fullName, token, expiresAt);
    return { inviteLink, expiresAt };
  }

  private async sendInvitation(email: string, fullName: string, token: string, expiresAt: Date): Promise<string> {
    const link = `${env.appUrl}/invite?token=${token}`;
    await this.mail.sendTemplate('INVITATION', email, {
      fullName,
      link,
      expiresAt: expiresAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
    });
    return link;
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

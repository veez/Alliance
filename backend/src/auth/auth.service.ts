import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserStatus } from '@prisma/client';
import { authenticator } from 'otplib';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { mfaDisabled, requiresMfa } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { AccessTokenPayload } from '../common/guards';
import { env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from './crypto';

authenticator.options = { window: 1 };

const TOTP_ISSUER = 'Альянс «Ценность каждого»';
const RESET_TTL_MS = 60 * 60 * 1000;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export type LoginResult = ({ twoFactorRequired: false } & SessionTokens) | { twoFactorRequired: true; challengeToken: string };

const INVALID_CREDENTIALS = 'Неверный email или пароль';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ───────────── Вход ─────────────

  async login(emailRaw: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await verifyPassword(await getDummyHash(), password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException('Слишком много неудачных попыток. Попробуйте позже.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const lock = failed >= env.loginMaxFailed;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + env.loginLockMinutes * 60_000) : undefined,
        },
      });
      await this.audit.log({ actorUserId: user.id, action: lock ? 'auth.locked' : 'auth.login_failed', entityType: 'User', entityId: user.id, meta });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException(INVALID_CREDENTIALS);

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });

    if (user.totpEnabledAt && !mfaDisabled()) {
      const challengeToken = await this.jwt.signAsync({ sub: user.id, typ: '2fa' }, { expiresIn: '5m' });
      return { twoFactorRequired: true, challengeToken };
    }
    return { twoFactorRequired: false, ...(await this.startSession(user, meta)) };
  }

  async loginWith2fa(challengeToken: string, code: string, meta: RequestMeta): Promise<SessionTokens> {
    let payload: { sub: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(challengeToken);
    } catch {
      throw new UnauthorizedException('Время на ввод кода истекло, войдите заново');
    }
    if (payload.typ !== '2fa') throw new UnauthorizedException('Неверный токен');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== UserStatus.ACTIVE || !user.totpSecretEnc || !user.totpEnabledAt) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!authenticator.check(code, decryptSecret(user.totpSecretEnc))) {
      await this.audit.log({ actorUserId: user.id, action: 'auth.2fa_failed', entityType: 'User', entityId: user.id, meta });
      throw new UnauthorizedException('Неверный код');
    }
    return this.startSession(user, meta);
  }

  private async startSession(user: User, meta: RequestMeta, familyId: string = randomUUID()): Promise<SessionTokens> {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + env.refreshTtlDays * 86_400_000);
    const session = await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        userAgent: meta.userAgent?.slice(0, 500),
        ip: meta.ip,
        expiresAt: refreshExpiresAt,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const payload: AccessTokenPayload = { sub: user.id, sid: session.id, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, refreshToken, refreshExpiresAt };
  }

  /** Ротация refresh-токена. Повторное использование отозванного токена отзывает всю цепочку сессий. */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<SessionTokens> {
    if (!refreshToken) throw new UnauthorizedException('Требуется вход');
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!session) throw new UnauthorizedException('Требуется вход');
    if (session.revokedAt) {
      await this.prisma.refreshSession.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorUserId: session.userId, action: 'auth.refresh_reuse', entityType: 'User', entityId: session.userId, meta });
      throw new UnauthorizedException('Сессия завершена, войдите заново');
    }
    if (session.expiresAt < new Date() || session.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Сессия истекла');
    }
    await this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.startSession(session.user, meta, session.familyId);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshSession.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ───────────── Профиль ─────────────

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        organization: { select: { id: true, name: true, shortName: true, status: true, kind: true, regionCode: true } },
        wgMemberships: { where: { role: 'LEAD' }, select: { workingGroupId: true } },
      },
    });
    const staff = u.systemRole === 'ADMIN' || u.systemRole === 'SECRETARY';
    const board = await this.prisma.workingGroup.findFirst({ where: { isBoard: true, ...(staff ? {} : { members: { some: { userId: u.id } } }) }, select: { id: true } });
    return {
      id: u.id,
      boardGroupId: board?.id ?? null,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      position: u.position,
      systemRole: u.systemRole,
      canViewAll: u.canViewAll,
      isDemo: u.isDemo,
      organization: u.organization,
      totpEnabled: !!u.totpEnabledAt,
      mfaRequired: requiresMfa(u.systemRole),
      mfaSetupPending: user.mfaSetupPending,
      ledWorkingGroupIds: u.wgMemberships.map((m) => m.workingGroupId),
      permissions: [...user.permissions].sort(),
    };
  }

  async changePassword(user: AuthUser, current: string, next: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(u.passwordHash, current))) throw new BadRequestException('Текущий пароль указан неверно');
    await this.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next) } });
    await this.audit.log({ actorUserId: u.id, action: 'auth.password_changed', entityType: 'User', entityId: u.id, meta });
  }

  // ───────────── 2FA ─────────────

  async setupTotp(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.totpEnabledAt) throw new BadRequestException('Двухфакторная аутентификация уже включена');
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: encryptSecret(secret) } });
    const otpauthUrl = authenticator.keyuri(u.email, TOTP_ISSUER, secret);
    return { secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) };
  }

  async enableTotp(user: AuthUser, code: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (u.totpEnabledAt) throw new BadRequestException('Двухфакторная аутентификация уже включена');
    if (!u.totpSecretEnc) throw new BadRequestException('Сначала получите QR-код');
    if (!authenticator.check(code, decryptSecret(u.totpSecretEnc))) throw new BadRequestException('Неверный код');
    await this.prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date() } });
    await this.audit.log({ actorUserId: u.id, action: 'auth.2fa_enabled', entityType: 'User', entityId: u.id, meta });
  }

  async disableTotp(user: AuthUser, code: string, meta: RequestMeta) {
    if (requiresMfa(user.systemRole)) throw new ForbiddenException('Для вашей роли двухфакторная аутентификация обязательна');
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.totpEnabledAt || !u.totpSecretEnc) throw new BadRequestException('Двухфакторная аутентификация не включена');
    if (!authenticator.check(code, decryptSecret(u.totpSecretEnc))) throw new BadRequestException('Неверный код');
    await this.prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: null, totpSecretEnc: null } });
    await this.audit.log({ actorUserId: u.id, action: 'auth.2fa_disabled', entityType: 'User', entityId: u.id, meta });
  }

  // ───────────── Приглашения ─────────────

  private async findValidInvitation(token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || inv.usedAt || inv.expiresAt < new Date()) throw new BadRequestException('Приглашение недействительно или устарело');
    const user = await this.prisma.user.findUnique({ where: { id: inv.userId } });
    if (!user || user.status === UserStatus.BLOCKED) throw new BadRequestException('Приглашение недействительно');
    return { inv, user };
  }

  async invitationInfo(token: string) {
    const { inv, user } = await this.findValidInvitation(token);
    const org = inv.organizationId
      ? await this.prisma.organization.findUnique({ where: { id: inv.organizationId }, select: { name: true } })
      : null;
    return { email: user.email, fullName: user.fullName, organizationName: org?.name ?? null, expiresAt: inv.expiresAt };
  }

  async acceptInvitation(token: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const { inv, user } = await this.findValidInvitation(token);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id: inv.id }, data: { usedAt: new Date() } });
      const u = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password), status: UserStatus.ACTIVE, failedLogins: 0, lockedUntil: null },
      });
      await this.audit.log({ actorUserId: u.id, action: 'auth.invitation_accepted', entityType: 'User', entityId: u.id, meta }, tx);
      return u;
    });
    return { twoFactorRequired: false, ...(await this.startSession(updated, meta)) };
  }

  // ───────────── Сброс пароля ─────────────

  /** Всегда отвечает одинаково, чтобы не раскрывать наличие учётной записи. */
  async forgotPassword(emailRaw: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.trim().toLowerCase() } });
    if (!user || user.status !== UserStatus.ACTIVE) return;
    const token = randomToken();
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    await this.mail.sendTemplate('PASSWORD_RESET', user.email, {
      fullName: user.fullName,
      link: `${env.appUrl}/reset-password?token=${token}`,
    });
    await this.audit.log({ actorUserId: user.id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, meta });
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const reset = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) throw new BadRequestException('Ссылка недействительна или устарела');
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null } });
      // Все открытые сессии завершаются
      await tx.refreshSession.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorUserId: reset.userId, action: 'auth.password_reset', entityType: 'User', entityId: reset.userId, meta }, tx);
    });
  }
}

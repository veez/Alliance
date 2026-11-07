import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { computePermissions, Permission, requiresMfa } from '../access/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth-user';
import { ALLOW_MFA_PENDING, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

/**
 * Глобальный guard: проверяет access-токен, загружает пользователя из БД
 * (блокировка и смена ролей действуют сразу), вычисляет права.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Требуется вход');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Сессия истекла');
    }
    if (payload.typ !== 'access') throw new UnauthorizedException('Неверный токен');

    const [user, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: payload.sub }, include: { organization: { select: { status: true } } } }),
      this.prisma.refreshSession.findUnique({ where: { id: payload.sid }, select: { revokedAt: true, userId: true } }),
    ]);
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Учётная запись недоступна');
    if (!session || session.revokedAt || session.userId !== user.id) throw new UnauthorizedException('Сессия завершена');

    const mfaSetupPending = requiresMfa(user.systemRole) && !user.totpEnabledAt;
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      systemRole: user.systemRole,
      canViewAll: user.canViewAll,
      organizationId: user.organizationId,
      organizationStatus: user.organization?.status ?? null,
      mfaSetupPending,
      permissions: computePermissions({
        systemRole: user.systemRole,
        canViewAll: user.canViewAll,
        organizationStatus: user.organization?.status ?? null,
        mfaSetupPending,
      }),
    };

    if (mfaSetupPending && !this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, targets)) {
      throw new ForbiddenException({ code: 'MFA_SETUP_REQUIRED', message: 'Настройте двухфакторную аутентификацию' });
    }
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) return false;
    if (!required.every((p) => user.permissions.has(p))) throw new ForbiddenException('Недостаточно прав');
    return true;
  }
}

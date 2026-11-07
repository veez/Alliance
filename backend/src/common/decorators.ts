import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import { Permission } from '../access/permissions';
import { AuthUser, RequestMeta } from './auth-user';

export const IS_PUBLIC = 'isPublic';
/** Эндпоинт доступен без входа. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_MFA_PENDING = 'allowMfaPending';
/** Эндпоинт доступен админу/секретарю, который ещё не включил 2FA. */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
/** Требует ВСЕ перечисленные права. */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req: Request = ctx.switchToHttp().getRequest();
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
});

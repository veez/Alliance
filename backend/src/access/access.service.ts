import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuthUser } from '../common/auth-user';
import { P } from './permissions';

/** Политики доступа к конкретным объектам. */
@Injectable()
export class AccessService {
  isOwnOrganization(user: AuthUser, organizationId: string): boolean {
    return !!user.organizationId && user.organizationId === organizationId;
  }

  canReadOrganizationFull(user: AuthUser, organizationId: string): boolean {
    return user.permissions.has(P.ORGS_READ_ALL) || this.isOwnOrganization(user, organizationId);
  }

  canEditOrganization(user: AuthUser, organizationId: string): boolean {
    return (
      user.permissions.has(P.ORGS_MANAGE) ||
      (user.permissions.has(P.ORG_EDIT_OWN) && this.isOwnOrganization(user, organizationId))
    );
  }

  canManageEmployees(user: AuthUser, organizationId: string): boolean {
    return (
      user.permissions.has(P.ORGS_MANAGE) ||
      (user.permissions.has(P.EMPLOYEES_MANAGE_OWN) && this.isOwnOrganization(user, organizationId))
    );
  }

  canReadEmployees(user: AuthUser, organizationId: string): boolean {
    return user.permissions.has(P.ORGS_READ_ALL) || this.isOwnOrganization(user, organizationId);
  }

  assert(condition: boolean, message = 'Недостаточно прав'): asserts condition {
    if (!condition) throw new ForbiddenException(message);
  }
}

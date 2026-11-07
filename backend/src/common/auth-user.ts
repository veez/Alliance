import { OrganizationStatus, SystemRole } from '@prisma/client';
import { Permission } from '../access/permissions';

/** Пользователь текущего запроса (заполняется JwtAuthGuard). */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  systemRole: SystemRole;
  canViewAll: boolean;
  organizationId: string | null;
  organizationStatus: OrganizationStatus | null;
  mfaSetupPending: boolean;
  permissions: Set<Permission>;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

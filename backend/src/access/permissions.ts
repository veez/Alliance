import { OrganizationStatus, SystemRole } from '@prisma/client';

/**
 * Права на действия. Права на конкретный объект (своя организация, своя рабочая группа)
 * проверяет AccessService поверх этих прав.
 */
export const P = {
  // Администрирование
  USERS_MANAGE: 'users.manage',
  INVITATIONS_SEND: 'invitations.send', // список пользователей и приглашения с обычной ролью
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_READ: 'audit.read',

  // Организации
  ORGS_READ_ALL: 'orgs.read_all', // полные карточки, реквизиты, история статусов, сотрудники любых организаций
  ORGS_MANAGE: 'orgs.manage', // создание, смена статуса, редактирование любой организации
  ORG_EDIT_OWN: 'org.edit_own',
  EMPLOYEES_MANAGE_OWN: 'employees.manage_own',

  // Рассылки
  MAILINGS_SEND: 'mailings.send',

  // Голосования
  VOTES_CREATE: 'votes.create',
  VOTES_READ_ALL: 'votes.read_all',
  VOTE_CAST: 'vote.cast',

  // Взносы
  DUES_READ_ALL: 'dues.read_all',
  DUES_MANAGE: 'dues.manage',
  DUES_READ_OWN: 'dues.read_own',

  // Мероприятия и протоколы
  EVENTS_MANAGE: 'events.manage',
  EVENTS_PARTICIPATE: 'events.participate',
  PROTOCOLS_MANAGE: 'protocols.manage',
  PROTOCOLS_READ: 'protocols.read',

  // Рабочие группы
  WG_MANAGE: 'wg.manage', // создание групп, назначение руководителей
  WG_READ_ALL: 'wg.read_all',
  WG_PARTICIPATE: 'wg.participate',

  // Карта и контакты
  MAP_READ: 'map.read',
  CONTACTS_READ: 'contacts.read',
  PARTNER_MATERIALS_READ: 'partner_materials.read',

  // Кандидат
  APPLICATION_EDIT_OWN: 'application.edit_own',
} as const;

export type Permission = (typeof P)[keyof typeof P];
export const ALL_PERMISSIONS: Permission[] = Object.values(P);

/** Права «видеть всё» (чтение) — у секретаря и у пользователей с особыми правами. */
const READ_ALL: Permission[] = [
  P.ORGS_READ_ALL,
  P.VOTES_READ_ALL,
  P.DUES_READ_ALL,
  P.DUES_READ_OWN,
  P.PROTOCOLS_READ,
  P.WG_READ_ALL,
  P.MAP_READ,
  P.CONTACTS_READ,
  P.PARTNER_MATERIALS_READ,
  P.AUDIT_READ,
];

const SECRETARY: Permission[] = [
  ...READ_ALL,
  P.MAILINGS_SEND,
  P.INVITATIONS_SEND,
  P.VOTES_CREATE,
  P.DUES_MANAGE,
  P.EVENTS_MANAGE,
  P.EVENTS_PARTICIPATE,
  P.PROTOCOLS_MANAGE,
  P.WG_PARTICIPATE,
];

const BY_ORG_STATUS: Record<OrganizationStatus, Permission[]> = {
  MEMBER: [
    P.VOTE_CAST,
    P.ORG_EDIT_OWN,
    P.EMPLOYEES_MANAGE_OWN,
    P.DUES_READ_OWN,
    P.EVENTS_PARTICIPATE,
    P.PROTOCOLS_READ,
    P.WG_PARTICIPATE,
    P.MAP_READ,
    P.CONTACTS_READ,
    P.PARTNER_MATERIALS_READ,
  ],
  CANDIDATE: [P.ORG_EDIT_OWN, P.APPLICATION_EDIT_OWN, P.MAP_READ],
  PARTNER: [P.ORG_EDIT_OWN, P.MAP_READ, P.PARTNER_MATERIALS_READ],
  SUSPENDED: [P.MAP_READ, P.DUES_READ_OWN],
  EXITED: [],
  APPLICANT: [],
  REJECTED: [],
  EXPELLED: [],
};

export interface PermissionSubject {
  systemRole: SystemRole;
  canViewAll: boolean;
  organizationStatus: OrganizationStatus | null;
  /** Админ/секретарь ещё не настроил обязательную 2FA — права не выдаются. */
  mfaSetupPending: boolean;
}

export function computePermissions(s: PermissionSubject): Set<Permission> {
  if (s.mfaSetupPending) return new Set();
  if (s.systemRole === SystemRole.ADMIN) return new Set(ALL_PERMISSIONS);

  const result = new Set<Permission>();
  const add = (list: Permission[]) => list.forEach((p) => result.add(p));

  if (s.systemRole === SystemRole.SECRETARY) add(SECRETARY);
  if (s.canViewAll) add(READ_ALL);
  if (s.organizationStatus) add(BY_ORG_STATUS[s.organizationStatus]);
  return result;
}

/** Демо-стенд: DISABLE_2FA=true полностью отключает второй фактор (вход только по паролю). Не использовать в рабочей среде. */
export function mfaDisabled(): boolean {
  return process.env.DISABLE_2FA === 'true';
}

/** Для админа и секретаря 2FA обязательна (кроме демо-стенда). */
export function requiresMfa(role: SystemRole): boolean {
  if (mfaDisabled()) return false;
  return role === SystemRole.ADMIN || role === SystemRole.SECRETARY;
}

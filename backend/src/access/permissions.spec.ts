import { OrganizationStatus, SystemRole } from '@prisma/client';
import { ALL_PERMISSIONS, computePermissions, P, PermissionSubject, requiresMfa } from './permissions';

const subject = (s: Partial<PermissionSubject>): PermissionSubject => ({
  systemRole: SystemRole.USER,
  canViewAll: false,
  organizationStatus: null,
  mfaSetupPending: false,
  ...s,
});

describe('RBAC: computePermissions', () => {
  it('администратор получает все права', () => {
    const p = computePermissions(subject({ systemRole: SystemRole.ADMIN }));
    expect(p.size).toBe(ALL_PERMISSIONS.length);
  });

  it('админ/секретарь без настроенной 2FA не получает никаких прав', () => {
    expect(computePermissions(subject({ systemRole: SystemRole.ADMIN, mfaSetupPending: true })).size).toBe(0);
    expect(computePermissions(subject({ systemRole: SystemRole.SECRETARY, mfaSetupPending: true })).size).toBe(0);
  });

  it('2FA обязательна только для администратора и секретаря', () => {
    expect(requiresMfa(SystemRole.ADMIN)).toBe(true);
    expect(requiresMfa(SystemRole.SECRETARY)).toBe(true);
    expect(requiresMfa(SystemRole.USER)).toBe(false);
  });

  it('секретарь видит всё, ведёт голосования/протоколы/взносы, но не управляет пользователями и статусами', () => {
    const p = computePermissions(subject({ systemRole: SystemRole.SECRETARY }));
    for (const perm of [P.ORGS_READ_ALL, P.VOTES_READ_ALL, P.DUES_READ_ALL, P.AUDIT_READ, P.VOTES_CREATE, P.PROTOCOLS_MANAGE, P.DUES_MANAGE, P.EVENTS_MANAGE]) {
      expect(p.has(perm)).toBe(true);
    }
    for (const perm of [P.USERS_MANAGE, P.ROLES_MANAGE, P.SETTINGS_MANAGE, P.ORGS_MANAGE]) expect(p.has(perm)).toBe(false);
  });

  it('особые права «видеть всё» дают только чтение', () => {
    const p = computePermissions(subject({ canViewAll: true, organizationStatus: OrganizationStatus.MEMBER }));
    expect(p.has(P.VOTES_READ_ALL)).toBe(true);
    expect(p.has(P.DUES_READ_ALL)).toBe(true);
    expect(p.has(P.ORGS_READ_ALL)).toBe(true);
    for (const perm of [P.VOTES_CREATE, P.DUES_MANAGE, P.USERS_MANAGE, P.ORGS_MANAGE, P.PROTOCOLS_MANAGE]) expect(p.has(perm)).toBe(false);
  });

  it('член Альянса голосует, видит контакты, управляет своими сотрудниками', () => {
    const p = computePermissions(subject({ organizationStatus: OrganizationStatus.MEMBER }));
    for (const perm of [P.VOTE_CAST, P.CONTACTS_READ, P.EMPLOYEES_MANAGE_OWN, P.ORG_EDIT_OWN, P.DUES_READ_OWN, P.WG_PARTICIPATE]) {
      expect(p.has(perm)).toBe(true);
    }
    for (const perm of [P.ORGS_READ_ALL, P.VOTES_READ_ALL, P.DUES_READ_ALL, P.AUDIT_READ]) expect(p.has(perm)).toBe(false);
  });

  it('кандидат: анкета и карта, без голосования и контактов', () => {
    const p = computePermissions(subject({ organizationStatus: OrganizationStatus.CANDIDATE }));
    expect([...p].sort()).toEqual([P.APPLICATION_EDIT_OWN, P.MAP_READ, P.ORG_EDIT_OWN].sort());
  });

  it('партнёр: своя карточка, карта и материалы для партнёров', () => {
    const p = computePermissions(subject({ organizationStatus: OrganizationStatus.PARTNER }));
    expect(p.has(P.PARTNER_MATERIALS_READ)).toBe(true);
    expect(p.has(P.VOTE_CAST)).toBe(false);
    expect(p.has(P.CONTACTS_READ)).toBe(false);
  });

  it('вышедшая из Альянса организация не получает прав', () => {
    expect(computePermissions(subject({ organizationStatus: OrganizationStatus.EXITED })).size).toBe(0);
  });

  it('приостановленный член не голосует', () => {
    expect(computePermissions(subject({ organizationStatus: OrganizationStatus.SUSPENDED })).has(P.VOTE_CAST)).toBe(false);
  });
});

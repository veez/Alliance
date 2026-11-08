/**
 * Убирает демо-организации и демо-людей. Голосования остаются: итоги завершённых сохранены,
 * поимённые записи исчезают вместе с организациями.
 *
 * Учётки не удаляются, а обезличиваются и блокируются: на них ссылаются голосования, протоколы
 * и журнал аудита, который менять нельзя. Единственная учётка администратора сохраняется
 * с новым случайным паролем, он выводится один раз.
 *
 * Запуск: npx ts-node --transpile-only prisma/remove-demo.ts
 */
import { randomBytes } from 'node:crypto';
import { FileEntityType, PrismaClient, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/auth/crypto';

const KEEP_ADMIN = 'admin@alliance.local';

export async function removeDemo(prisma: PrismaClient, keepEmail = KEEP_ADMIN) {
  const password = randomBytes(15).toString('base64url');
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(
    async (tx) => {
      const admin = await tx.user.findFirst({ where: { email: keepEmail, isDemo: true }, select: { id: true } });
      const users = await tx.user.findMany({ where: { isDemo: true, ...(admin ? { id: { not: admin.id } } : {}) }, select: { id: true } });
      const userIds = users.map((u) => u.id);
      const orgs = await tx.organization.findMany({ where: { isDemo: true }, select: { id: true } });
      const orgIds = orgs.map((o) => o.id);

      await tx.workingGroupMember.deleteMany({ where: { userId: { in: userIds } } });
      await tx.eventAttendance.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] } });
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
      await tx.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
      await tx.refreshSession.deleteMany({ where: { userId: { in: userIds } } });
      await tx.passwordReset.deleteMany({ where: { userId: { in: userIds } } });
      await tx.invitation.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] } });

      for (const id of userIds) {
        await tx.user.update({
          where: { id },
          data: {
            email: `removed-${id}@deleted.local`,
            fullName: 'Удалённая демо-учётка',
            phone: null,
            position: null,
            organizationId: null,
            passwordHash: null,
            totpSecretEnc: null,
            totpEnabledAt: null,
            canViewAll: false,
            status: UserStatus.BLOCKED,
            contactPrivacy: {},
          },
        });
      }

      const dues = await tx.dues.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
      const agreements = await tx.donationAgreement.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
      await tx.fileLink.deleteMany({
        where: {
          OR: [
            { entityType: FileEntityType.DUES, entityId: { in: dues.map((d) => d.id) } },
            { entityType: FileEntityType.AGREEMENT, entityId: { in: agreements.map((a) => a.id) } },
          ],
        },
      });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });

      if (admin) {
        await tx.user.update({ where: { id: admin.id }, data: { isDemo: false, passwordHash } });
        await tx.refreshSession.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return { users: userIds.length, organizations: orgIds.length, adminPassword: admin ? password : null };
    },
    { timeout: 120_000 },
  );
}

if (require.main === module) {
  const prisma = new PrismaClient();
  removeDemo(prisma)
    .then((r) => {
      console.log(`Убрано организаций: ${r.organizations}, обезличено учёток: ${r.users}`);
      if (r.adminPassword) console.log(`Новый пароль ${KEEP_ADMIN}: ${r.adminPassword}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

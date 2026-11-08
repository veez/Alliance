/**
 * Создаёт учётки сотрудникам организаций, у которых есть почта. Статус — «Создан» (INVITED).
 * Писем не отправляет: ссылку-приглашение администратор копирует в разделе «Пользователи».
 * Организации из списка отказов и исключённые пропускаются.
 *
 * Проверка без записи: npx ts-node --transpile-only prisma/create-users.ts
 * Запись в базу:       npx ts-node --transpile-only prisma/create-users.ts --apply
 */
import { OrganizationStatus, PrismaClient, UserStatus } from '@prisma/client';

const SKIPPED_STATUSES: OrganizationStatus[] = [OrganizationStatus.REJECTED, OrganizationStatus.EXPELLED];

export async function createUsers(prisma: PrismaClient, apply: boolean) {
  const employees = await prisma.employee.findMany({
    where: { userId: null, email: { not: null }, organization: { isDemo: false, status: { notIn: SKIPPED_STATUSES } } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, fullName: true, position: true, phone: true, email: true, organizationId: true },
  });
  const issues: string[] = [];
  const planned = new Set<string>();
  let created = 0;
  for (const e of employees) {
    const email = e.email!.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      issues.push(`Некорректная почта: ${e.fullName}`);
      continue;
    }
    if (planned.has(email) || (await prisma.user.findUnique({ where: { email }, select: { id: true } }))) {
      issues.push(`Почта уже занята другой учёткой: ${e.fullName} (${email})`);
      continue;
    }
    planned.add(email);
    created++;
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, fullName: e.fullName, position: e.position, phone: e.phone, organizationId: e.organizationId, status: UserStatus.INVITED } });
      await tx.employee.update({ where: { id: e.id }, data: { userId: user.id } });
    });
  }
  if (apply && created) await prisma.auditLog.create({ data: { action: 'user.bulk_created', entityType: 'User', after: { created } } });
  return { created, issues };
}

if (require.main === module) {
  const apply = process.argv[2] === '--apply';
  const prisma = new PrismaClient();
  createUsers(prisma, apply)
    .then((r) => {
      console.log(`${apply ? 'Создано' : 'Будет создано'} учёток: ${r.created}`);
      if (r.issues.length) console.log(`Замечания (${r.issues.length}):\n - ${r.issues.join('\n - ')}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

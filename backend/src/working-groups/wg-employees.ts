import { Prisma, PrismaClient, WgRole } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Сотрудник без учётки хранится в working_group_employees. Как только у него появляется учётка,
 * он становится обычным участником группы с той же ролью.
 */
export async function syncEmployeeMembers(prisma: Db, workingGroupId?: string): Promise<void> {
  const rows = await prisma.workingGroupEmployee.findMany({
    where: { workingGroupId, employee: { userId: { not: null } } },
    include: { employee: { select: { userId: true } } },
  });
  for (const r of rows) {
    const userId = r.employee.userId!;
    await prisma.workingGroupMember.upsert({
      where: { workingGroupId_userId: { workingGroupId: r.workingGroupId, userId } },
      update: r.role === WgRole.LEAD ? { role: WgRole.LEAD } : {},
      create: { workingGroupId: r.workingGroupId, userId, role: r.role },
    });
    await prisma.workingGroupEmployee.delete({ where: { workingGroupId_employeeId: { workingGroupId: r.workingGroupId, employeeId: r.employeeId } } });
  }
}

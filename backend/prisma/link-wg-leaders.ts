/**
 * Превращает руководителей рабочих групп, записанных текстом, в руководителей из числа сотрудников
 * организаций-членов. Несколько руководителей разделены знаком «+» или «;». Кого не удалось
 * однозначно найти, остаётся текстом.
 *
 * Проверка без записи: npx ts-node --transpile-only prisma/link-wg-leaders.ts
 * Запись в базу:       npx ts-node --transpile-only prisma/link-wg-leaders.ts --apply
 */
import { OrganizationStatus, PrismaClient, UserStatus, WgRole } from '@prisma/client';

const words = (name: string) => new Set(name.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean));

function sameName(a: string, b: string): boolean {
  const [x, y] = [words(a), words(b)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return small.size >= 2 && [...small].every((w) => big.has(w));
}

export async function linkWgLeaders(prisma: PrismaClient, apply: boolean) {
  const groups = await prisma.workingGroup.findMany({ where: { isDemo: false, isBoard: false, leaderNames: { not: null } }, orderBy: { name: 'asc' } });
  const employees = await prisma.employee.findMany({
    where: { organization: { status: OrganizationStatus.MEMBER, isDemo: false } },
    select: { id: true, fullName: true, userId: true, user: { select: { status: true } } },
  });
  const linked: string[] = [];
  const unmatched: string[] = [];

  for (const g of groups) {
    const left: string[] = [];
    for (const segment of g.leaderNames!.replace(/\s+/g, ' ').trim().split(/\s*[+;]\s*/).filter(Boolean)) {
      const name = segment.replace(/\(.*$/, '').trim();
      const found = employees.filter((e) => sameName(e.fullName, name));
      if (found.length !== 1 || found[0]!.user?.status === UserStatus.BLOCKED) {
        left.push(segment);
        unmatched.push(`${name} (${g.name}): ${found.length > 1 ? 'найдено несколько' : 'нет среди сотрудников организаций-членов'}`);
        continue;
      }
      const e = found[0]!;
      linked.push(`${e.fullName} → ${g.name}`);
      if (!apply) continue;
      if (e.userId) {
        await prisma.workingGroupMember.upsert({
          where: { workingGroupId_userId: { workingGroupId: g.id, userId: e.userId } },
          update: { role: WgRole.LEAD },
          create: { workingGroupId: g.id, userId: e.userId, role: WgRole.LEAD },
        });
      } else {
        await prisma.workingGroupEmployee.upsert({
          where: { workingGroupId_employeeId: { workingGroupId: g.id, employeeId: e.id } },
          update: { role: WgRole.LEAD },
          create: { workingGroupId: g.id, employeeId: e.id, role: WgRole.LEAD },
        });
      }
    }
    if (apply) await prisma.workingGroup.update({ where: { id: g.id }, data: { leaderNames: left.length ? left.join(' + ') : null } });
  }
  if (apply && linked.length) await prisma.auditLog.create({ data: { action: 'wg.leaders_linked', entityType: 'WorkingGroup', after: { linked: linked.length, unmatched: unmatched.length } } });
  return { linked, unmatched };
}

if (require.main === module) {
  const apply = process.argv[2] === '--apply';
  const prisma = new PrismaClient();
  linkWgLeaders(prisma, apply)
    .then((r) => {
      console.log(`${apply ? 'Назначено' : 'Будет назначено'} руководителей: ${r.linked.length}\n - ${r.linked.join('\n - ')}`);
      if (r.unmatched.length) console.log(`Остаются текстом (${r.unmatched.length}):\n - ${r.unmatched.join('\n - ')}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

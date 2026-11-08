/**
 * Вносит правление из листа «Правление» (board.csv) в закрытый раздел портала.
 * Выполняется после import-alliance и make-admin. Письма не отправляются: ссылки передаются вручную.
 *
 * Запуск: npx ts-node --transpile-only prisma/setup-board.ts <папка с CSV>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, SystemRole, UserStatus } from '@prisma/client';
import { randomToken, sha256 } from '../src/auth/crypto';
import { header, parseCsv, parsePerson, Person, pick, samePerson } from './import-alliance';

const INVITE_DAYS = 7;

export async function setupBoard(prisma: PrismaClient, dir: string) {
  const board = await prisma.workingGroup.findFirst({ where: { isBoard: true }, select: { id: true } });
  if (!board) throw new Error('Раздел правления не создан: запустите seed');
  const rows = parseCsv(readFileSync(join(dir, 'board.csv'), 'utf8'));
  const h = header(rows[1] ?? []);
  const tagged = await prisma.employee.findMany({ where: { allianceTags: { has: 'BOARD' }, organization: { isDemo: false } } });
  const admin = await prisma.user.findFirst({ where: { systemRole: SystemRole.ADMIN, status: UserStatus.ACTIVE, isDemo: false }, select: { id: true } });
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

  const issues: string[] = [];
  const members: string[] = [];
  const invites: Array<{ fullName: string; link: string }> = [];
  const matched = new Set<string>();

  for (const row of rows.slice(2)) {
    if (!row.some((c) => c.trim())) continue;
    const person = parsePerson(pick(row, h), issues, row[h.org!] ?? '');
    if (!person) continue;
    const employee = tagged.find((e) => samePerson({ fullName: e.fullName, telegram: e.telegram } as Person, person));
    if (!employee) {
      issues.push(`Нет сотрудника с пометкой «правление»: ${person.fullName}`);
      continue;
    }
    matched.add(employee.id);
    let user = employee.userId ? await prisma.user.findUnique({ where: { id: employee.userId } }) : person.email ? await prisma.user.findUnique({ where: { email: person.email } }) : null;
    if (!user) {
      if (!person.email) {
        issues.push(`Нет почты: ${person.fullName}`);
        continue;
      }
      user = await prisma.user.create({
        data: { email: person.email, fullName: employee.fullName, position: employee.position, organizationId: employee.organizationId, status: UserStatus.INVITED },
      });
    }
    if (!employee.userId && !(await prisma.employee.findUnique({ where: { userId: user.id } }))) {
      await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
    }
    await prisma.workingGroupMember.upsert({
      where: { workingGroupId_userId: { workingGroupId: board.id, userId: user.id } },
      update: {},
      create: { workingGroupId: board.id, userId: user.id },
    });
    members.push(employee.fullName);

    if (user.passwordHash) continue;
    const open = await prisma.invitation.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } } });
    if (open) continue; // повторную ссылку выдаёт администратор в разделе «Пользователи»
    const token = randomToken();
    await prisma.invitation.create({
      data: { email: user.email, tokenHash: sha256(token), userId: user.id, organizationId: employee.organizationId, systemRole: user.systemRole, createdById: admin?.id ?? user.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
    });
    invites.push({ fullName: employee.fullName, link: `${appUrl}/invite?token=${token}` });
  }

  for (const e of tagged.filter((x) => !matched.has(x.id))) issues.push(`Помечен «правление» в списке членов, но нет на листе «Правление»: ${e.fullName}`);
  return { members, invites, issues };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('Укажите папку с CSV');
  const prisma = new PrismaClient();
  setupBoard(prisma, dir)
    .then((r) => {
      console.log(`В правлении: ${r.members.length} — ${r.members.join('; ')}`);
      for (const i of r.invites) console.log(`${i.fullName}: ${i.link}`);
      if (r.issues.length) console.log(`Замечания:\n - ${r.issues.join('\n - ')}`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

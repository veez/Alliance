/**
 * Назначает администратора из числа представителей организации.
 * Новому человеку создаёт личное приглашение: пароль он задаёт сам.
 *
 * Запуск: npx ts-node --transpile-only prisma/make-admin.ts <email> "<ФИО>" "<часть названия организации>"
 */
import { PrismaClient, SystemRole, UserStatus } from '@prisma/client';
import { encryptSecret, randomToken, sha256 } from '../src/auth/crypto';

const INVITE_DAYS = 7;

export async function makeAdmin(prisma: PrismaClient, args: { email: string; fullName: string; organization: string }) {
  const email = args.email.trim().toLowerCase();
  const orgs = await prisma.organization.findMany({ where: { name: { contains: args.organization, mode: 'insensitive' }, isDemo: false }, select: { id: true, name: true } });
  if (orgs.length !== 1) throw new Error(`Организаций по запросу «${args.organization}» найдено: ${orgs.length}, нужна одна`);
  const organizationId = orgs[0]!.id;

  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { systemRole: SystemRole.ADMIN, fullName: args.fullName, organizationId } })
    : await prisma.user.create({ data: { email, fullName: args.fullName, systemRole: SystemRole.ADMIN, organizationId, status: UserStatus.INVITED } });

  // Связываем учётку с записью сотрудника, если она ещё ни к кому не привязана
  const words = args.fullName.toLowerCase().split(/\s+/);
  const employees = await prisma.employee.findMany({ where: { organizationId, userId: null } });
  const employee = employees.find((e) => words.every((w) => e.fullName.toLowerCase().includes(w)));
  if (employee && !(await prisma.employee.findUnique({ where: { userId: user.id } }))) {
    await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
  }

  if (existing?.passwordHash) return { organization: orgs[0]!.name, inviteLink: null, linkedEmployee: !!employee };
  await prisma.invitation.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken();
  await prisma.invitation.create({
    data: { email, tokenHash: sha256(token), tokenEnc: encryptSecret(token), userId: user.id, organizationId, systemRole: SystemRole.ADMIN, createdById: user.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  return { organization: orgs[0]!.name, inviteLink: `${appUrl}/invite?token=${token}`, linkedEmployee: !!employee };
}

if (require.main === module) {
  const [email, fullName, organization] = process.argv.slice(2);
  if (!email || !fullName || !organization) throw new Error('Укажите email, ФИО и часть названия организации');
  const prisma = new PrismaClient();
  makeAdmin(prisma, { email, fullName, organization })
    .then((r) => {
      console.log(`Администратор назначен · ${r.organization} · сотрудник связан: ${r.linkedEmployee ? 'да' : 'нет'}`);
      console.log(r.inviteLink ? `Ссылка для установки пароля (действует ${INVITE_DAYS} дней): ${r.inviteLink}` : 'Пароль уже задан, приглашение не требуется');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

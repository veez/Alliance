/** Демо-взносы за 2 года и договоры пожертвования (этап 3). Добавляются, если ещё нет настроек взносов. */
import { AgreementStatus, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { computeDuesStatus } from '../src/dues/dues-logic';

type PaymentSeed = [amount: number, paidAt: string, doc?: string];

export async function seedDues(prisma: PrismaClient) {
  if (await prisma.duesSettings.count()) {
    console.log('Настройки взносов уже есть — демо-взносы не добавляются');
    return;
  }
  const secretary = await prisma.user.findUnique({ where: { email: 'secretary@alliance.local' } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@alliance.local' }, organization: { status: 'MEMBER' } }, include: { organization: true } });
  const org = (login: string) => users.find((u) => u.email === `${login}@alliance.local`)?.organization;

  async function textFile(name: string, text: string) {
    const buffer = Buffer.from(text, 'utf8');
    const storageKey = `seed/${randomUUID()}`;
    const path = resolve(process.cwd(), process.env.STORAGE_DIR ?? 'var/files', storageKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buffer);
    return prisma.file.create({
      data: { storageKey, originalName: name, mime: 'text/plain', size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), uploadedById: secretary?.id },
    });
  }

  const years = [
    { year: 2025, amount: 30000, dueDate: '2025-03-31' },
    { year: 2026, amount: 36000, dueDate: '2026-12-01' },
  ];
  for (const y of years) await prisma.duesSettings.create({ data: { year: y.year, amount: y.amount, dueDate: new Date(y.dueDate), graceDays: 0 } });

  // login → по годам: [сумма начисления | null (по умолчанию), платежи, освобождение]
  const plan: Record<string, Record<number, { amount?: number; payments: PaymentSeed[]; waived?: boolean }>> = {
    opora: { 2025: { payments: [[30000, '2025-02-14', '112']] }, 2026: { payments: [[36000, '2026-02-10', '87']] } },
    apk: { 2025: { payments: [[30000, '2025-03-20', '45']] }, 2026: { payments: [[36000, '2026-04-02', '61']] } },
    kazhdyi: { 2025: { payments: [[15000, '2025-03-01'], [15000, '2025-05-12']] }, 2026: { payments: [[18000, '2026-06-15', '204']] } },
    ucmz: { 2025: { payments: [[30000, '2025-03-28']] }, 2026: { payments: [] } },
    sask: { 2025: { payments: [[30000, '2025-01-30']] }, 2026: { payments: [[36000, '2026-03-03', '19']] } },
    vmeste: { 2025: { payments: [[10000, '2025-04-15']] }, 2026: { payments: [] } },
    belova: { 2025: { amount: 10000, payments: [], waived: true }, 2026: { amount: 10000, payments: [[10000, '2026-05-20']] } },
  };

  let duesCount = 0;
  for (const [login, perYear] of Object.entries(plan)) {
    const o = org(login);
    if (!o) continue;
    for (const y of years) {
      const p = perYear[y.year];
      if (!p) continue;
      const amountDue = p.amount ?? y.amount;
      const dues = await prisma.dues.create({
        data: {
          organizationId: o.id,
          year: y.year,
          amountDue,
          dueDate: new Date(y.dueDate),
          status: p.waived ? 'WAIVED' : 'UNPAID',
          note: p.waived ? 'Освобождение решением общего собрания (частный специалист, первый год)' : amountDue !== y.amount ? 'Сниженный взнос для частного специалиста' : null,
        },
      });
      duesCount++;
      for (const [amount, paidAt, doc] of p.payments) {
        await prisma.duesPayment.create({ data: { duesId: dues.id, amount, paidAt: new Date(paidAt), documentNumber: doc, recordedById: secretary?.id } });
        if (doc) {
          const f = await textFile(`Платёжное поручение № ${doc}.txt`, `Платёжное поручение № ${doc} от ${paidAt}\nПлательщик: ${o.name}\nСумма: ${amount} руб.\nНазначение: членский взнос за ${y.year} год\n(демо-документ)`);
          await prisma.fileLink.create({ data: { fileId: f.id, entityType: 'DUES', entityId: dues.id, docType: 'PAYMENT_ORDER' } });
        }
      }
      const paidTotal = p.payments.reduce((s, [a]) => s + a, 0);
      const status = computeDuesStatus({ amountDue, paidTotal, dueDate: new Date(y.dueDate), graceDays: 0, current: p.waived ? 'WAIVED' : 'UNPAID' });
      await prisma.dues.update({ where: { id: dues.id }, data: { status } });
    }
  }

  const agreements: Array<[string, string, number, string | null, number | null, AgreementStatus, boolean]> = [
    ['opora', 'ДП-2025/01', 2025, '2025-01-20', 30000, 'SIGNED', true],
    ['opora', 'ДП-2026/01', 2026, '2026-01-25', 36000, 'SIGNED', true],
    ['apk', 'ДП-2026/02', 2026, '2026-03-10', 36000, 'SIGNED', true],
    ['sask', 'ДП-2026/03', 2026, '2026-02-01', 36000, 'SIGNED', false],
    ['kazhdyi', 'ДП-2026/04', 2026, null, 36000, 'DRAFT', false],
  ];
  for (const [login, number, year, signedAt, amount, status, withFile] of agreements) {
    const o = org(login);
    if (!o) continue;
    const a = await prisma.donationAgreement.create({ data: { organizationId: o.id, number, year, signedAt: signedAt ? new Date(signedAt) : null, amount, status } });
    if (withFile) {
      const f = await textFile(`Договор пожертвования ${number}.txt`, `ДОГОВОР ПОЖЕРТВОВАНИЯ № ${number}\nЖертвователь: ${o.name}\nПолучатель: Альянс «Ценность каждого»\nСумма: ${amount} руб.\n(демо-документ)`);
      await prisma.fileLink.create({ data: { fileId: f.id, entityType: 'AGREEMENT', entityId: a.id, docType: 'AGREEMENT' } });
    }
  }
  console.log(`Демо-взносы: ${duesCount} начислений за 2025–2026, ${agreements.length} договоров пожертвования`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedDues(prisma).finally(() => prisma.$disconnect());
}

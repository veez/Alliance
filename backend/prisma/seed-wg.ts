/** Демо-планы, задачи и обсуждения рабочих групп (этап 5). Добавляются, если планов ещё нет. Даты — относительно сегодня. */
import { PlanStatus, PrismaClient, TaskStatus } from '@prisma/client';

const day = (n: number) => {
  const d = new Date(Date.now() + 3 * 3_600_000 + n * 86_400_000);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
};

export async function seedWorkingGroups(prisma: PrismaClient) {
  if (await prisma.wgPlanItem.count()) {
    console.log('Планы рабочих групп уже есть — демо-данные РГ не добавляются');
    return;
  }
  const users = await prisma.user.findMany({ where: { email: { endsWith: '@alliance.local' } } });
  const u = (login: string) => users.find((x) => x.email === `${login}@alliance.local`)!;
  const group = async (prefix: string) => prisma.workingGroup.findFirst({ where: { name: { startsWith: prefix } } });
  const standards = await group('РГ по стандартам');
  const policy = await group('РГ по взаимодействию');
  const education = await group('РГ по обучению');
  if (!standards || !policy || !education || !u('opora')) return;

  await prisma.workingGroup.update({
    where: { id: standards.id },
    data: { description: 'Группа готовит стандарт сопровождения семьи: от первичной консультации до завершения работы. Встречи — раз в две недели онлайн.' },
  });

  type Plan = { title: string; description?: string; start?: number; due?: number; status: PlanStatus; who?: string };
  type Task = { title: string; description?: string; who?: string; by: string; due?: number; status: TaskStatus; plan?: number; comments?: Array<[string, string]> };
  async function fill(groupId: string, plan: Plan[], tasks: Task[]) {
    const items = [];
    for (const p of plan) {
      items.push(
        await prisma.wgPlanItem.create({
          data: {
            workingGroupId: groupId,
            title: p.title,
            description: p.description,
            startDate: p.start === undefined ? null : day(p.start),
            dueDate: p.due === undefined ? null : day(p.due),
            status: p.status,
            responsibleUserId: p.who ? u(p.who).id : null,
          },
        }),
      );
    }
    for (const t of tasks) {
      const task = await prisma.wgTask.create({
        data: {
          workingGroupId: groupId,
          planItemId: t.plan === undefined ? null : items[t.plan].id,
          title: t.title,
          description: t.description,
          assigneeId: t.who ? u(t.who).id : null,
          dueDate: t.due === undefined ? null : day(t.due),
          status: t.status,
          doneAt: t.status === 'DONE' ? day(-3) : null,
          createdById: u(t.by).id,
        },
      });
      for (const [login, body] of t.comments ?? []) {
        await prisma.comment.create({ data: { entityType: 'TASK', entityId: task.id, authorId: u(login).id, body } });
      }
    }
  }

  await fill(
    standards.id,
    [
      { title: 'Раздел «Первичная консультация»', start: -60, due: -10, status: 'DONE', who: 'opora' },
      { title: 'Раздел «Индивидуальный план сопровождения»', start: -20, due: 25, status: 'IN_PROGRESS', who: 'sask' },
      { title: 'Раздел «Завершение сопровождения и оценка результатов»', start: 20, due: 70, status: 'PLANNED', who: 'vmeste' },
      { title: 'Апробация стандарта в 3 организациях', start: 70, due: 160, status: 'PLANNED' },
    ],
    [
      { title: 'Доработать раздел с учётом замечаний заседания', who: 'opora', by: 'opora', due: -5, status: 'DONE', plan: 0 },
      {
        title: 'Собрать шаблоны индивидуальных планов от организаций-членов',
        description: 'Нужны действующие шаблоны (обезличенные) — минимум от 4 организаций.',
        who: 'sask',
        by: 'opora',
        due: 6,
        status: 'IN_PROGRESS',
        plan: 1,
        comments: [
          ['sask', 'Получила шаблоны от «Опоры» и АПК, жду ещё два.'],
          ['opora', 'Спасибо! РЦ «Вместе» обещали прислать до пятницы.'],
        ],
      },
      { title: 'Прислать шаблон плана сопровождения РЦ «Вместе»', who: 'vmeste', by: 'opora', due: -2, status: 'TODO', plan: 1 },
      { title: 'Подготовить сравнительную таблицу шаблонов', who: 'opora', by: 'opora', due: 14, status: 'TODO', plan: 1 },
      { title: 'Предложить критерии оценки результатов сопровождения', who: 'vmeste', by: 'opora', due: 40, status: 'TODO', plan: 2 },
    ],
  );
  await fill(
    policy.id,
    [
      { title: 'Позиция Альянса по законопроекту о психологической помощи', due: -30, status: 'DONE', who: 'kazhdyi' },
      { title: 'Участие в общественных слушаниях в Общественной палате', start: 10, due: 30, status: 'PLANNED', who: 'kazhdyi' },
    ],
    [
      { title: 'Подготовить тезисы выступления на слушаниях', who: 'kazhdyi', by: 'kazhdyi', due: 20, status: 'IN_PROGRESS', plan: 1 },
      { title: 'Собрать примеры региональных практик поддержки семей', who: 'opora', by: 'kazhdyi', due: 15, status: 'TODO', plan: 1 },
    ],
  );
  await fill(
    education.id,
    [
      { title: 'Программа супервизии на 2027 год', start: -10, due: 40, status: 'IN_PROGRESS', who: 'ucmz' },
      { title: 'Цикл вебинаров для специалистов', start: 40, due: 200, status: 'PLANNED', who: 'apk' },
    ],
    [
      { title: 'Сформировать список супервизоров', who: 'apk', by: 'ucmz', due: 10, status: 'TODO', plan: 0 },
      { title: 'Черновик программы супервизии', who: 'belova', by: 'ucmz', due: 25, status: 'TODO', plan: 0 },
    ],
  );
  console.log('Демо-данные рабочих групп: планы, задачи, обсуждения');
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedWorkingGroups(prisma).finally(() => prisma.$disconnect());
}

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginAdminWith2fa, loginNewCandidate, loginSecretary } from './helpers';

describe('Рабочие группы (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let lead: string; // opora — руководитель РГ по стандартам
  let member: string; // sask — участник
  let outsider: string; // ucmz — не в группе
  let candidate: string;
  let groupId: string;
  const uid = async (login: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${login}@alliance.local` } })).id;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    lead = await login(app, 'opora@alliance.local');
    member = await login(app, 'sask@alliance.local');
    outsider = await login(app, 'ucmz@alliance.local');
    candidate = await loginNewCandidate(app, prisma, 'wg');
    groupId = (await prisma.workingGroup.findFirstOrThrow({ where: { name: { startsWith: 'РГ по стандартам' } } })).id;
  });
  afterAll(() => app.close());

  it('список видят члены Альянса и секретарь, не видят кандидаты', async () => {
    const res = await http().get('/api/working-groups').set(auth(member)).expect(200);
    const g = res.body.find((x: { id: string }) => x.id === groupId);
    expect(g.myRole).toBe('MEMBER');
    expect(g.leads[0].fullName).toBeTruthy();
    expect(g.progress).toBeGreaterThan(0);
    await http().get('/api/working-groups').set(auth(await loginSecretary(app))).expect(200);
    await http().get('/api/working-groups').set(auth(candidate)).expect(403);
  });

  it('обзор группы открыт всем членам, задачи и файлы — только участникам', async () => {
    const res = await http().get(`/api/working-groups/${groupId}`).set(auth(outsider)).expect(200);
    expect(res.body.fullAccess).toBe(false);
    expect(res.body.canJoin).toBe(true);
    expect(res.body.plan.length).toBeGreaterThan(0);
    await http().get(`/api/working-groups/${groupId}/tasks`).set(auth(outsider)).expect(403);
    await http().get(`/api/working-groups/${groupId}/files`).set(auth(outsider)).expect(403);
    const own = await http().get(`/api/working-groups/${groupId}`).set(auth(lead)).expect(200);
    expect(own.body).toMatchObject({ myRole: 'LEAD', canManage: true, fullAccess: true });
  });

  it('вступление и выход; последний руководитель выйти не может', async () => {
    await http().post(`/api/working-groups/${groupId}/join`).set(auth(outsider)).expect(200);
    await http().post(`/api/working-groups/${groupId}/join`).set(auth(outsider)).expect(409);
    const leads = await prisma.notification.count({ where: { userId: await uid('opora'), type: 'WG_MEMBER_JOINED' } });
    expect(leads).toBeGreaterThan(0);
    await http().get(`/api/working-groups/${groupId}/tasks`).set(auth(outsider)).expect(200);
    await http().delete(`/api/working-groups/${groupId}/members/${await uid('ucmz')}`).set(auth(outsider)).expect(204);
    await http().delete(`/api/working-groups/${groupId}/members/${await uid('opora')}`).set(auth(lead)).expect(400);
  });

  it('участниками управляет руководитель; назначить руководителя — только админ', async () => {
    const cands = await http().get(`/api/working-groups/${groupId}/candidates`).set(auth(lead)).expect(200);
    const apkId = await uid('apk');
    expect(cands.body.some((c: { id: string }) => c.id === apkId)).toBe(true);
    expect(cands.body.some((c: { id: string }) => c.id === undefined)).toBe(false);
    await http().get(`/api/working-groups/${groupId}/candidates`).set(auth(member)).expect(403);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ userId: await uid('candidate-wg') }).expect(400); // кандидат
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ userId: apkId, role: 'LEAD' }).expect(403);
    await http().post(`/api/working-groups/${groupId}/members`).set(auth(lead)).send({ userId: apkId }).expect(201);
    await http().patch(`/api/working-groups/${groupId}/members/${apkId}`).set(auth(lead)).send({ role: 'LEAD' }).expect(403);
    await http().delete(`/api/working-groups/${groupId}/members/${apkId}`).set(auth(member)).expect(403);
    await http().delete(`/api/working-groups/${groupId}/members/${apkId}`).set(auth(lead)).expect(204);
  });

  it('план: ведёт руководитель, ответственный меняет только статус своего пункта', async () => {
    await http().post(`/api/working-groups/${groupId}/plan`).set(auth(member)).send({ title: 'Пункт' }).expect(403);
    await http().post(`/api/working-groups/${groupId}/plan`).set(auth(lead)).send({ title: 'Пункт', responsibleUserId: await uid('ucmz') }).expect(400);
    const item = await http()
      .post(`/api/working-groups/${groupId}/plan`)
      .set(auth(lead))
      .send({ title: 'Тестовый пункт плана', dueDate: '2026-12-31', responsibleUserId: await uid('sask') })
      .expect(201);
    await http().patch(`/api/working-groups/${groupId}/plan/${item.body.id}`).set(auth(member)).send({ status: 'IN_PROGRESS' }).expect(200);
    await http().patch(`/api/working-groups/${groupId}/plan/${item.body.id}`).set(auth(member)).send({ title: 'Другое' }).expect(403);
    await http().delete(`/api/working-groups/${groupId}/plan/${item.body.id}`).set(auth(lead)).expect(204);
  });

  it('задачи: поручения, права исполнителя, уведомления, просрочка', async () => {
    const saskId = await uid('sask');
    // участник может создать задачу только себе
    await http().post(`/api/working-groups/${groupId}/tasks`).set(auth(member)).send({ title: 'Чужая', assigneeId: await uid('opora') }).expect(403);
    await http().post(`/api/working-groups/${groupId}/tasks`).set(auth(member)).send({ title: 'Своя задача', assigneeId: saskId }).expect(201);
    await http().post(`/api/working-groups/${groupId}/tasks`).set(auth(outsider)).send({ title: 'Посторонний' }).expect(403);
    await http().post(`/api/working-groups/${groupId}/tasks`).set(auth(lead)).send({ title: 'Не участнику', assigneeId: await uid('ucmz') }).expect(400);

    const t = await http().post(`/api/working-groups/${groupId}/tasks`).set(auth(lead)).send({ title: 'Поручение для теста', assigneeId: saskId, dueDate: '2020-01-01' }).expect(201);
    expect(await prisma.notification.count({ where: { userId: saskId, type: 'WG_TASK_ASSIGNED', link: { contains: t.body.id } } })).toBe(1);

    const list = await http().get(`/api/working-groups/${groupId}/tasks?mine=true`).set(auth(member)).expect(200);
    const row = list.body.find((x: { id: string }) => x.id === t.body.id);
    expect(row).toMatchObject({ overdue: true, canEdit: 'status' });

    await http().patch(`/api/working-groups/${groupId}/tasks/${t.body.id}`).set(auth(member)).send({ title: 'Переименовать' }).expect(403);
    const done = await http().patch(`/api/working-groups/${groupId}/tasks/${t.body.id}`).set(auth(member)).send({ status: 'DONE' }).expect(200);
    expect(done.body.overdue).toBe(false);
    expect(done.body.doneAt).toBeTruthy();

    const act = await http().get('/api/working-groups/my-activity').set(auth(member)).expect(200);
    expect(act.body.groups.some((g: { id: string }) => g.id === groupId)).toBe(true);
    expect(act.body.myTasks.every((x: { status: string }) => x.status !== 'DONE')).toBe(true);

    await http().delete(`/api/working-groups/${groupId}/tasks/${t.body.id}`).set(auth(member)).expect(403);
    await http().delete(`/api/working-groups/${groupId}/tasks/${t.body.id}`).set(auth(lead)).expect(204);
  });

  it('обсуждение задачи: комментарий уведомляет исполнителя, удаляет автор или руководитель', async () => {
    const t = await http().post(`/api/working-groups/${groupId}/tasks`).set(auth(lead)).send({ title: 'Задача с обсуждением', assigneeId: await uid('sask') }).expect(201);
    const c = await http().post(`/api/working-groups/${groupId}/comments`).set(auth(lead)).send({ entityType: 'TASK', entityId: t.body.id, body: 'Как продвигается?' }).expect(201);
    expect(await prisma.notification.count({ where: { userId: await uid('sask'), type: 'WG_COMMENT' } })).toBeGreaterThan(0);
    await http().post(`/api/working-groups/${groupId}/comments`).set(auth(outsider)).send({ entityType: 'TASK', entityId: t.body.id, body: 'x' }).expect(403);
    const other = await prisma.wgTask.findFirstOrThrow({ where: { workingGroupId: { not: groupId } } });
    await http().post(`/api/working-groups/${groupId}/comments`).set(auth(lead)).send({ entityType: 'TASK', entityId: other.id, body: 'x' }).expect(404);
    const list = await http().get(`/api/working-groups/${groupId}/comments?entityType=TASK&entityId=${t.body.id}`).set(auth(member)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].canDelete).toBe(false);
    await http().delete(`/api/working-groups/${groupId}/comments/${c.body.id}`).set(auth(member)).expect(403);
    await http().delete(`/api/working-groups/${groupId}/comments/${c.body.id}`).set(auth(lead)).expect(204);
  });

  it('файловый архив: загружают участники, удаляет загрузивший или руководитель', async () => {
    const up = await http().post(`/api/working-groups/${groupId}/files`).set(auth(member)).attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'черновик.pdf', contentType: 'application/pdf' }).expect(201);
    await http().post(`/api/working-groups/${groupId}/files`).set(auth(member)).attach('file', Buffer.from('MZ'), { filename: 'a.exe', contentType: 'application/x-msdownload' }).expect(400);
    const files = await http().get(`/api/working-groups/${groupId}/files`).set(auth(lead)).expect(200);
    expect(files.body[0]).toMatchObject({ originalName: 'черновик.pdf', canDelete: true, uploadedBy: { fullName: expect.any(String) } });
    await http().get(`/api/working-groups/${groupId}/files/${up.body.id}`).set(auth(member)).expect(200);
    await http().get(`/api/working-groups/${groupId}/files/${up.body.id}`).set(auth(outsider)).expect(403);
    await http().delete(`/api/working-groups/${groupId}/files/${up.body.id}`).set(auth(member)).expect(204);
    expect(await prisma.auditLog.count({ where: { action: 'wg.file_removed', entityId: groupId } })).toBe(1);
  });

  it('создание и архивирование группы — администратор; руководитель правит описание', async () => {
    await http().post('/api/working-groups').set(auth(lead)).send({ name: 'Новая РГ' }).expect(403);
    await http().patch(`/api/working-groups/${groupId}`).set(auth(lead)).send({ description: 'Обновлённое описание' }).expect(200);
    await http().patch(`/api/working-groups/${groupId}`).set(auth(lead)).send({ status: 'ARCHIVED' }).expect(403);
    await http().patch(`/api/working-groups/${groupId}`).set(auth(member)).send({ description: 'x' }).expect(403);

    const admin = await loginAdminWith2fa(app, prisma);
    const g = await http().post('/api/working-groups').set(auth(admin)).send({ name: 'РГ по цифровым сервисам', leadUserId: await uid('ucmz') }).expect(201);
    const view = await http().get(`/api/working-groups/${g.body.id}`).set(auth(outsider)).expect(200);
    expect(view.body.myRole).toBe('LEAD');
    await http().patch(`/api/working-groups/${g.body.id}`).set(auth(admin)).send({ status: 'ARCHIVED' }).expect(200);
    await http().post(`/api/working-groups/${g.body.id}/tasks`).set(auth(outsider)).send({ title: 'После архива' }).expect(400);
    await http().post(`/api/working-groups/${g.body.id}/join`).set(auth(member)).expect(400);
  });

  it('протокол рабочей группы ведёт её руководитель', async () => {
    const p = await http()
      .post('/api/protocols')
      .set(auth(lead))
      .send({ title: 'Протокол заседания РГ', heldAt: new Date().toISOString(), workingGroupId: groupId, items: [{ agendaText: 'Вопрос' }] })
      .expect(201);
    await http().post(`/api/protocols/${p.body.id}/publish`).set(auth(lead)).expect(200);
    const list = await http().get(`/api/protocols?workingGroupId=${groupId}`).set(auth(member)).expect(200);
    expect(list.body.items.some((x: { id: string }) => x.id === p.body.id)).toBe(true);
    await http().post('/api/protocols').set(auth(member)).send({ title: 'Чужой протокол', heldAt: new Date().toISOString(), workingGroupId: groupId, items: [] }).expect(403);
  });
});

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommentEntityType, EventStatus, FileEntityType, OrganizationStatus, PlanStatus, Prisma, TaskStatus, UserStatus, WgRole, WorkingGroupStatus } from '@prisma/client';
import { P } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { FilesService, UploadedFileLike } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { countTasks, isTaskOverdue, planProgress, taskEditScope } from './wg-logic';
import { CommentDto, CommentQuery, MemberDto, PlanItemDto, TaskDto, TaskListQuery, UpdatePlanItemDto, UpdateTaskDto, UpdateWorkingGroupDto, WorkingGroupDto } from './wg.dto';

const USER_BRIEF = { select: { id: true, fullName: true } } as const;
const ALLOWED_MIME =
  /^(application\/pdf|image\/(png|jpeg|webp)|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.oasis\.opendocument\.[\w.]+|zip)|text\/(plain|csv))$/;
const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(`${v.slice(0, 10)}T00:00:00Z`));

interface Ctx {
  group: { id: string; name: string; status: WorkingGroupStatus; isBoard: boolean };
  role: WgRole | null;
  canManage: boolean;
  fullAccess: boolean;
}

@Injectable()
export class WorkingGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── Доступ ─────────────

  private assertListAccess(u: AuthUser) {
    if (!u.permissions.has(P.WG_PARTICIPATE) && !u.permissions.has(P.WG_READ_ALL) && !u.permissions.has(P.WG_MANAGE)) throw new ForbiddenException('Недостаточно прав');
  }

  /** Обзор группы виден всем участникам Альянса; задачи, обсуждения и файлы — участникам группы и «видящим всё». */
  private async ctx(id: string, u: AuthUser): Promise<Ctx> {
    this.assertListAccess(u);
    const group = await this.prisma.workingGroup.findUnique({ where: { id }, select: { id: true, name: true, status: true, isBoard: true } });
    if (!group) throw new NotFoundException('Рабочая группа не найдена');
    const m = await this.prisma.workingGroupMember.findUnique({ where: { workingGroupId_userId: { workingGroupId: id, userId: u.id } } });
    const role = m?.role ?? null;
    // Правление закрыто и от «видящих всё»: доступ только у участников, секретаря и администратора
    const staff = u.systemRole === 'ADMIN' || u.systemRole === 'SECRETARY';
    if (group.isBoard && !role && !staff) throw new NotFoundException('Рабочая группа не найдена');
    const canManage = u.permissions.has(P.WG_MANAGE) || role === WgRole.LEAD || (group.isBoard && staff);
    return { group, role, canManage, fullAccess: canManage || !!role || u.permissions.has(P.WG_READ_ALL) };
  }

  private requireFull(c: Ctx) {
    if (!c.fullAccess) throw new ForbiddenException('Раздел доступен участникам рабочей группы');
  }
  /** Писать (задачи, комментарии, файлы) могут участники группы и руководитель. */
  private requireMember(c: Ctx) {
    if (!c.role && !c.canManage) throw new ForbiddenException('Действие доступно участникам рабочей группы');
    if (c.group.status === WorkingGroupStatus.ARCHIVED) throw new BadRequestException('Группа в архиве');
  }
  private requireManage(c: Ctx) {
    if (!c.canManage) throw new ForbiddenException('Действие доступно руководителю рабочей группы');
  }

  private async assertMember(groupId: string, userId: string | null | undefined, what: string) {
    if (!userId) return;
    const m = await this.prisma.workingGroupMember.findUnique({ where: { workingGroupId_userId: { workingGroupId: groupId, userId } } });
    if (!m) throw new BadRequestException(`${what} должен быть участником группы`);
  }

  // ───────────── Группы ─────────────

  async list(u: AuthUser) {
    this.assertListAccess(u);
    const groups = await this.prisma.workingGroup.findMany({
      where: { isBoard: false },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        members: { include: { user: USER_BRIEF } },
        planItems: { select: { status: true } },
        tasks: { select: { status: true, dueDate: true } },
      },
    });
    return groups.map(({ members, planItems, tasks, ...g }) => ({
      ...g,
      leads: members.filter((m) => m.role === WgRole.LEAD).map((m) => m.user),
      membersCount: members.length,
      myRole: members.find((m) => m.userId === u.id)?.role ?? null,
      progress: planProgress(planItems),
      tasks: countTasks(tasks),
    }));
  }

  async get(id: string, u: AuthUser) {
    const c = await this.ctx(id, u);
    const g = await this.prisma.workingGroup.findUniqueOrThrow({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, fullName: true, position: true, organization: { select: { id: true, name: true, shortName: true } } } } },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        },
        planItems: { include: { responsible: USER_BRIEF, tasks: { select: { status: true, dueDate: true } } }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] },
        tasks: { select: { status: true, dueDate: true } },
        events: { where: { startsAt: { gte: new Date() }, status: { not: EventStatus.CANCELLED } }, orderBy: { startsAt: 'asc' }, take: 5, select: { id: true, title: true, startsAt: true, format: true } },
        _count: { select: { protocols: { where: { status: 'PUBLISHED' } } } },
      },
    });
    const files = c.fullAccess ? await this.prisma.fileLink.count({ where: { entityType: FileEntityType.WORKING_GROUP, entityId: id } }) : 0;
    return {
      id: g.id,
      name: g.name,
      goals: g.goals,
      description: g.description,
      status: g.status,
      isDemo: g.isDemo,
      isBoard: g.isBoard,
      chatVk: g.chatVk,
      chatTelegram: g.chatTelegram,
      chatMax: g.chatMax,
      leaderNames: g.leaderNames,
      createdAt: g.createdAt,
      myRole: c.role,
      canManage: c.canManage,
      fullAccess: c.fullAccess,
      canJoin: !g.isBoard && !c.role && g.status === WorkingGroupStatus.ACTIVE && u.permissions.has(P.WG_PARTICIPATE),
      members: g.members.map((m) => ({
        userId: m.userId,
        fullName: m.user.fullName,
        position: m.user.position,
        organization: m.user.organization ? { id: m.user.organization.id, name: m.user.organization.shortName || m.user.organization.name } : null,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      plan: g.planItems.map(({ tasks, ...p }) => ({ ...p, tasks: countTasks(tasks) })),
      progress: planProgress(g.planItems),
      tasks: countTasks(g.tasks),
      upcomingEvents: g.events,
      publishedProtocols: g._count.protocols,
      files,
    };
  }

  async create(dto: WorkingGroupDto, u: AuthUser, meta: RequestMeta) {
    if (dto.leadUserId) await this.assertEligibleUser(dto.leadUserId);
    const g = await this.prisma.workingGroup.create({
      data: {
        name: dto.name,
        goals: dto.goals ?? null,
        description: dto.description ?? null,
        chatVk: dto.chatVk ?? null,
        chatTelegram: dto.chatTelegram ?? null,
        chatMax: dto.chatMax ?? null,
        leaderNames: dto.leaderNames ?? null,
        members: dto.leadUserId ? { create: { userId: dto.leadUserId, role: WgRole.LEAD } } : undefined,
      },
    });
    await this.audit.log({ actorUserId: u.id, action: 'wg.created', entityType: 'WorkingGroup', entityId: g.id, after: { name: g.name, leadUserId: dto.leadUserId }, meta });
    return g;
  }

  async update(id: string, dto: UpdateWorkingGroupDto, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireManage(c);
    if (dto.status && !u.permissions.has(P.WG_MANAGE)) throw new ForbiddenException('Архивировать группу может администратор');
    const before = await this.prisma.workingGroup.findUniqueOrThrow({ where: { id } });
    const g = await this.prisma.workingGroup.update({
      where: { id },
      data: { name: dto.name, goals: dto.goals, description: dto.description, status: dto.status, chatVk: dto.chatVk, chatTelegram: dto.chatTelegram, chatMax: dto.chatMax, leaderNames: dto.leaderNames },
    });
    await this.audit.log({
      actorUserId: u.id,
      action: 'wg.updated',
      entityType: 'WorkingGroup',
      entityId: id,
      before: { name: before.name, goals: before.goals, description: before.description, status: before.status },
      after: { name: g.name, goals: g.goals, description: g.description, status: g.status },
      meta,
    });
    return g;
  }

  // ───────────── Участники ─────────────

  /** Добавлять можно активных пользователей организаций-членов Альянса. */
  private async assertEligibleUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { organization: { select: { status: true } } } });
    if (!user || user.status !== UserStatus.ACTIVE || user.organization?.status !== OrganizationStatus.MEMBER) {
      throw new BadRequestException('В рабочую группу можно добавить только активного пользователя организации — члена Альянса');
    }
    return user;
  }

  async candidates(id: string, u: AuthUser) {
    const c = await this.ctx(id, u);
    this.requireManage(c);
    const users = await this.prisma.user.findMany({
      where: { status: UserStatus.ACTIVE, organization: { status: OrganizationStatus.MEMBER }, wgMemberships: { none: { workingGroupId: id } } },
      select: { id: true, fullName: true, organization: { select: { name: true, shortName: true } } },
      orderBy: { fullName: 'asc' },
    });
    return users.map((x) => ({ id: x.id, fullName: x.fullName, organization: x.organization?.shortName || x.organization?.name || null }));
  }

  async addMember(id: string, dto: MemberDto, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireManage(c);
    if (dto.role === WgRole.LEAD && !u.permissions.has(P.WG_MANAGE)) throw new ForbiddenException('Назначить руководителя может администратор');
    const user = await this.assertEligibleUser(dto.userId);
    try {
      await this.prisma.workingGroupMember.create({ data: { workingGroupId: id, userId: dto.userId, role: dto.role ?? WgRole.MEMBER } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Пользователь уже в группе');
      throw e;
    }
    await this.audit.log({ actorUserId: u.id, action: 'wg.member_added', entityType: 'WorkingGroup', entityId: id, after: { userId: dto.userId, role: dto.role ?? WgRole.MEMBER }, meta });
    await this.notifications.notifyUsers([user], { type: 'WG_MEMBER_ADDED', title: `Вы добавлены в рабочую группу «${c.group.name}»`, link: `/working-groups/${id}` });
    return { ok: true };
  }

  async setRole(id: string, userId: string, role: WgRole, u: AuthUser, meta: RequestMeta) {
    await this.ctx(id, u);
    if (!u.permissions.has(P.WG_MANAGE)) throw new ForbiddenException('Назначить руководителя может администратор');
    const m = await this.prisma.workingGroupMember.findUnique({ where: { workingGroupId_userId: { workingGroupId: id, userId } } });
    if (!m) throw new NotFoundException('Участник не найден');
    await this.prisma.workingGroupMember.update({ where: { workingGroupId_userId: { workingGroupId: id, userId } }, data: { role } });
    await this.audit.log({ actorUserId: u.id, action: 'wg.role_changed', entityType: 'WorkingGroup', entityId: id, before: { userId, role: m.role }, after: { userId, role }, meta });
    return { ok: true };
  }

  /** Исключить участника (руководитель, админ) или выйти из группы самому. */
  async removeMember(id: string, userId: string, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    const self = userId === u.id;
    if (!self) this.requireManage(c);
    const m = await this.prisma.workingGroupMember.findUnique({ where: { workingGroupId_userId: { workingGroupId: id, userId } } });
    if (!m) throw new NotFoundException('Участник не найден');
    if (m.role === WgRole.LEAD && !u.permissions.has(P.WG_MANAGE)) {
      const leads = await this.prisma.workingGroupMember.count({ where: { workingGroupId: id, role: WgRole.LEAD } });
      if (leads <= 1) throw new BadRequestException('Нельзя оставить группу без руководителя — обратитесь к администратору');
    }
    await this.prisma.workingGroupMember.delete({ where: { workingGroupId_userId: { workingGroupId: id, userId } } });
    await this.audit.log({ actorUserId: u.id, action: self ? 'wg.left' : 'wg.member_removed', entityType: 'WorkingGroup', entityId: id, before: { userId, role: m.role }, meta });
  }

  async join(id: string, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    if (!u.permissions.has(P.WG_PARTICIPATE) || c.group.isBoard) throw new ForbiddenException('Недостаточно прав');
    if (c.group.status !== WorkingGroupStatus.ACTIVE) throw new BadRequestException('Группа в архиве');
    if (c.role) throw new ConflictException('Вы уже в группе');
    await this.prisma.workingGroupMember.create({ data: { workingGroupId: id, userId: u.id } });
    await this.audit.log({ actorUserId: u.id, action: 'wg.joined', entityType: 'WorkingGroup', entityId: id, meta });
    const leads = await this.prisma.workingGroupMember.findMany({ where: { workingGroupId: id, role: WgRole.LEAD }, include: { user: true } });
    await this.notifications.notifyUsers(
      leads.map((l) => l.user),
      { type: 'WG_MEMBER_JOINED', title: `Новый участник группы «${c.group.name}»`, body: u.fullName, link: `/working-groups/${id}` },
    );
    return { ok: true };
  }

  // ───────────── План ─────────────

  async addPlanItem(id: string, dto: PlanItemDto, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireManage(c);
    await this.assertMember(id, dto.responsibleUserId, 'Ответственный');
    const item = await this.prisma.wgPlanItem.create({
      data: {
        workingGroupId: id,
        title: dto.title,
        description: dto.description ?? null,
        startDate: date(dto.startDate),
        dueDate: date(dto.dueDate),
        status: dto.status ?? PlanStatus.PLANNED,
        responsibleUserId: dto.responsibleUserId ?? null,
      },
    });
    await this.audit.log({ actorUserId: u.id, action: 'wg.plan_added', entityType: 'WorkingGroup', entityId: id, after: { planItemId: item.id, title: item.title }, meta });
    return item;
  }

  async updatePlanItem(id: string, itemId: string, dto: UpdatePlanItemDto, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    const before = await this.prisma.wgPlanItem.findFirst({ where: { id: itemId, workingGroupId: id } });
    if (!before) throw new NotFoundException('Пункт плана не найден');
    // Ответственный может менять статус своего пункта
    const onlyStatus = Object.keys(dto).every((k) => k === 'status');
    if (!c.canManage && !(onlyStatus && before.responsibleUserId === u.id)) this.requireManage(c);
    await this.assertMember(id, dto.responsibleUserId, 'Ответственный');
    const item = await this.prisma.wgPlanItem.update({
      where: { id: itemId },
      data: {
        title: dto.title,
        description: dto.description,
        startDate: date(dto.startDate),
        dueDate: date(dto.dueDate),
        status: dto.status,
        responsibleUserId: dto.responsibleUserId,
      },
    });
    await this.audit.log({
      actorUserId: u.id,
      action: 'wg.plan_updated',
      entityType: 'WorkingGroup',
      entityId: id,
      before: { planItemId: itemId, title: before.title, status: before.status, dueDate: before.dueDate },
      after: { planItemId: itemId, title: item.title, status: item.status, dueDate: item.dueDate },
      meta,
    });
    return item;
  }

  async removePlanItem(id: string, itemId: string, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireManage(c);
    const item = await this.prisma.wgPlanItem.findFirst({ where: { id: itemId, workingGroupId: id } });
    if (!item) throw new NotFoundException('Пункт плана не найден');
    await this.prisma.$transaction([
      this.prisma.wgTask.updateMany({ where: { planItemId: itemId }, data: { planItemId: null } }),
      this.prisma.comment.deleteMany({ where: { entityType: CommentEntityType.PLAN_ITEM, entityId: itemId } }),
      this.prisma.wgPlanItem.delete({ where: { id: itemId } }),
    ]);
    await this.audit.log({ actorUserId: u.id, action: 'wg.plan_removed', entityType: 'WorkingGroup', entityId: id, before: { planItemId: itemId, title: item.title }, meta });
  }

  // ───────────── Задачи ─────────────

  private taskView<T extends { status: TaskStatus; dueDate: Date | null }>(t: T) {
    return { ...t, overdue: isTaskOverdue(t) };
  }

  async tasks(id: string, q: TaskListQuery, u: AuthUser) {
    const c = await this.ctx(id, u);
    this.requireFull(c);
    const rows = await this.prisma.wgTask.findMany({
      where: { workingGroupId: id, status: q.status, planItemId: q.planItemId, assigneeId: q.mine ? u.id : q.assigneeId },
      include: { assignee: USER_BRIEF, createdBy: USER_BRIEF, planItem: { select: { id: true, title: true } } },
      orderBy: [{ status: 'asc' }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const counts = await this.prisma.comment.groupBy({ by: ['entityId'], where: { entityType: CommentEntityType.TASK, entityId: { in: rows.map((r) => r.id) } }, _count: true });
    return rows.map((t) => ({
      ...this.taskView(t),
      comments: counts.find((x) => x.entityId === t.id)?._count ?? 0,
      canEdit: taskEditScope({ canManage: c.canManage, isAssignee: t.assigneeId === u.id, isAuthor: t.createdById === u.id }),
    }));
  }

  private async notifyAssignee(groupId: string, groupName: string, taskId: string, title: string, assigneeId: string | null | undefined, actorId: string) {
    if (!assigneeId || assigneeId === actorId) return;
    const user = await this.prisma.user.findUnique({ where: { id: assigneeId } });
    if (!user) return;
    await this.notifications.notifyUsers([user], { type: 'WG_TASK_ASSIGNED', title: `Вам поручена задача: ${title}`, body: `Рабочая группа «${groupName}»`, link: `/working-groups/${groupId}?tab=tasks&task=${taskId}` });
  }

  async createTask(id: string, dto: TaskDto, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireMember(c);
    // Участник может создать задачу себе; поручить другому — руководитель
    if (dto.assigneeId && dto.assigneeId !== u.id && !c.canManage) throw new ForbiddenException('Поручать задачи другим участникам может руководитель группы');
    await this.assertMember(id, dto.assigneeId, 'Исполнитель');
    if (dto.planItemId && !(await this.prisma.wgPlanItem.findFirst({ where: { id: dto.planItemId, workingGroupId: id } }))) throw new BadRequestException('Пункт плана не найден');
    const status = dto.status ?? TaskStatus.TODO;
    const t = await this.prisma.wgTask.create({
      data: {
        workingGroupId: id,
        title: dto.title,
        description: dto.description ?? null,
        planItemId: dto.planItemId ?? null,
        assigneeId: dto.assigneeId ?? null,
        dueDate: date(dto.dueDate),
        status,
        doneAt: status === TaskStatus.DONE ? new Date() : null,
        createdById: u.id,
      },
    });
    await this.audit.log({ actorUserId: u.id, action: 'wg.task_created', entityType: 'WorkingGroup', entityId: id, after: { taskId: t.id, title: t.title, assigneeId: t.assigneeId }, meta });
    await this.notifyAssignee(id, c.group.name, t.id, t.title, t.assigneeId, u.id);
    return t;
  }

  async updateTask(id: string, taskId: string, dto: UpdateTaskDto, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireFull(c);
    const before = await this.prisma.wgTask.findFirst({ where: { id: taskId, workingGroupId: id } });
    if (!before) throw new NotFoundException('Задача не найдена');
    const scope = taskEditScope({ canManage: c.canManage, isAssignee: before.assigneeId === u.id, isAuthor: before.createdById === u.id });
    if (scope === 'none') throw new ForbiddenException('Задачу может изменить руководитель группы или исполнитель');
    if (scope === 'status' && Object.keys(dto).some((k) => !['status', 'description'].includes(k))) {
      throw new ForbiddenException('Исполнитель может менять только статус и описание задачи');
    }
    await this.assertMember(id, dto.assigneeId, 'Исполнитель');
    if (dto.planItemId && !(await this.prisma.wgPlanItem.findFirst({ where: { id: dto.planItemId, workingGroupId: id } }))) throw new BadRequestException('Пункт плана не найден');
    const doneAt = dto.status === undefined ? undefined : dto.status === TaskStatus.DONE ? (before.doneAt ?? new Date()) : null;
    const t = await this.prisma.wgTask.update({
      where: { id: taskId },
      data: { title: dto.title, description: dto.description, planItemId: dto.planItemId, assigneeId: dto.assigneeId, dueDate: date(dto.dueDate), status: dto.status, doneAt },
    });
    await this.audit.log({
      actorUserId: u.id,
      action: 'wg.task_updated',
      entityType: 'WorkingGroup',
      entityId: id,
      before: { taskId, title: before.title, status: before.status, assigneeId: before.assigneeId, dueDate: before.dueDate },
      after: { taskId, title: t.title, status: t.status, assigneeId: t.assigneeId, dueDate: t.dueDate },
      meta,
    });
    if (dto.assigneeId && dto.assigneeId !== before.assigneeId) await this.notifyAssignee(id, c.group.name, t.id, t.title, t.assigneeId, u.id);
    return this.taskView(t);
  }

  async removeTask(id: string, taskId: string, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    const t = await this.prisma.wgTask.findFirst({ where: { id: taskId, workingGroupId: id } });
    if (!t) throw new NotFoundException('Задача не найдена');
    if (!c.canManage && !(t.createdById === u.id && t.status !== TaskStatus.DONE)) throw new ForbiddenException('Удалить задачу может руководитель группы или её автор');
    await this.prisma.$transaction([
      this.prisma.comment.deleteMany({ where: { entityType: CommentEntityType.TASK, entityId: taskId } }),
      this.prisma.wgTask.delete({ where: { id: taskId } }),
    ]);
    await this.audit.log({ actorUserId: u.id, action: 'wg.task_removed', entityType: 'WorkingGroup', entityId: id, before: { taskId, title: t.title }, meta });
  }

  /** Мои рабочие группы и задачи — для дашборда. */
  async myActivity(u: AuthUser) {
    const memberships = await this.prisma.workingGroupMember.findMany({
      where: { userId: u.id, workingGroup: { status: WorkingGroupStatus.ACTIVE } },
      include: {
        workingGroup: {
          include: {
            tasks: { select: { status: true, dueDate: true, assigneeId: true } },
            events: { where: { startsAt: { gte: new Date() }, status: EventStatus.PLANNED }, orderBy: { startsAt: 'asc' }, take: 1, select: { id: true, title: true, startsAt: true } },
          },
        },
      },
    });
    const myTasks = await this.prisma.wgTask.findMany({
      where: { assigneeId: u.id, status: { not: TaskStatus.DONE } },
      include: { workingGroup: { select: { id: true, name: true } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: 10,
    });
    return {
      groups: memberships.map((m) => ({
        id: m.workingGroupId,
        name: m.workingGroup.name,
        role: m.role,
        tasks: countTasks(m.workingGroup.tasks),
        myOpenTasks: m.workingGroup.tasks.filter((t) => t.assigneeId === u.id && t.status !== TaskStatus.DONE).length,
        nextEvent: m.workingGroup.events[0] ?? null,
      })),
      myTasks: myTasks.map((t) => this.taskView({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, workingGroup: t.workingGroup })),
    };
  }

  // ───────────── Обсуждения ─────────────

  private async assertCommentTarget(groupId: string, entityType: CommentEntityType, entityId: string) {
    const ok =
      entityType === CommentEntityType.TASK
        ? await this.prisma.wgTask.findFirst({ where: { id: entityId, workingGroupId: groupId } })
        : entityType === CommentEntityType.PLAN_ITEM
          ? await this.prisma.wgPlanItem.findFirst({ where: { id: entityId, workingGroupId: groupId } })
          : null;
    if (!ok) throw new NotFoundException('Объект обсуждения не найден');
    return ok;
  }

  async comments(id: string, q: CommentQuery, u: AuthUser) {
    const c = await this.ctx(id, u);
    this.requireFull(c);
    await this.assertCommentTarget(id, q.entityType, q.entityId);
    const rows = await this.prisma.comment.findMany({ where: { entityType: q.entityType, entityId: q.entityId }, include: { author: USER_BRIEF }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ ...r, canDelete: r.authorId === u.id || c.canManage }));
  }

  async addComment(id: string, dto: CommentDto, u: AuthUser) {
    const c = await this.ctx(id, u);
    this.requireMember(c);
    const target = await this.assertCommentTarget(id, dto.entityType, dto.entityId);
    const comment = await this.prisma.comment.create({ data: { entityType: dto.entityType, entityId: dto.entityId, authorId: u.id, body: dto.body }, include: { author: USER_BRIEF } });
    // Уведомляем исполнителя и автора задачи (или ответственного за пункт плана)
    const t = target as { title: string; assigneeId?: string | null; createdById?: string; responsibleUserId?: string | null };
    const ids = [...new Set([t.assigneeId, t.createdById, t.responsibleUserId].filter((x): x is string => !!x && x !== u.id))];
    if (ids.length) {
      const users = await this.prisma.user.findMany({ where: { id: { in: ids } } });
      await this.notifications.notifyUsers(users, {
        type: 'WG_COMMENT',
        title: `Комментарий: ${t.title}`,
        body: `${u.fullName}: ${dto.body.slice(0, 200)}`,
        link: `/working-groups/${id}?tab=${dto.entityType === CommentEntityType.TASK ? `tasks&task=${dto.entityId}` : 'plan'}`,
      });
    }
    return { ...comment, canDelete: true };
  }

  async removeComment(id: string, commentId: string, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    const cm = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!cm) throw new NotFoundException('Комментарий не найден');
    await this.assertCommentTarget(id, cm.entityType, cm.entityId);
    if (cm.authorId !== u.id && !c.canManage) throw new ForbiddenException('Удалить комментарий может автор или руководитель группы');
    await this.prisma.comment.delete({ where: { id: commentId } });
    if (cm.authorId !== u.id) await this.audit.log({ actorUserId: u.id, action: 'wg.comment_removed', entityType: 'WorkingGroup', entityId: id, before: { commentId, authorId: cm.authorId, body: cm.body }, meta });
  }

  // ───────────── Файловый архив ─────────────

  async filesList(id: string, u: AuthUser) {
    const c = await this.ctx(id, u);
    this.requireFull(c);
    const links = await this.prisma.fileLink.findMany({
      where: { entityType: FileEntityType.WORKING_GROUP, entityId: id },
      include: { file: { select: { id: true, originalName: true, mime: true, size: true, createdAt: true, uploadedById: true, uploadedBy: USER_BRIEF } } },
      orderBy: { createdAt: 'desc' },
    });
    return links.map(({ file: { uploadedById, ...f } }) => ({ ...f, canDelete: c.canManage || uploadedById === u.id }));
  }

  async addFile(id: string, file: UploadedFileLike | undefined, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    this.requireMember(c);
    if (!file) throw new BadRequestException('Файл не передан');
    const saved = await this.files.save(file, u.id, { maxBytes: 30 * 1024 * 1024, allowedMime: ALLOWED_MIME });
    await this.prisma.fileLink.create({ data: { fileId: saved.id, entityType: FileEntityType.WORKING_GROUP, entityId: id, docType: 'ATTACHMENT' } });
    await this.audit.log({ actorUserId: u.id, action: 'wg.file_added', entityType: 'WorkingGroup', entityId: id, after: { fileId: saved.id, name: saved.originalName }, meta });
    return { id: saved.id, originalName: saved.originalName, mime: saved.mime, size: saved.size, createdAt: saved.createdAt };
  }

  async openFile(id: string, fileId: string, u: AuthUser) {
    const c = await this.ctx(id, u);
    this.requireFull(c);
    const link = await this.prisma.fileLink.findFirst({ where: { entityType: FileEntityType.WORKING_GROUP, entityId: id, fileId } });
    if (!link) throw new NotFoundException('Файл не найден');
    return this.files.open(fileId);
  }

  async removeFile(id: string, fileId: string, u: AuthUser, meta: RequestMeta) {
    const c = await this.ctx(id, u);
    const link = await this.prisma.fileLink.findFirst({ where: { entityType: FileEntityType.WORKING_GROUP, entityId: id, fileId }, include: { file: true } });
    if (!link) throw new NotFoundException('Файл не найден');
    if (!c.canManage && link.file.uploadedById !== u.id) throw new ForbiddenException('Удалить файл может загрузивший его или руководитель группы');
    await this.prisma.fileLink.delete({ where: { fileId_entityType_entityId: { fileId, entityType: FileEntityType.WORKING_GROUP, entityId: id } } });
    await this.audit.log({ actorUserId: u.id, action: 'wg.file_removed', entityType: 'WorkingGroup', entityId: id, before: { fileId, name: link.file.originalName }, meta });
  }
}

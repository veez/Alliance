/** Чистые правила модуля рабочих групп (покрыты unit-тестами). */
import { PlanStatus, TaskStatus } from '@prisma/client';

/** Сегодняшняя дата по Москве в виде YYYY-MM-DD. */
export function mskToday(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Задача просрочена, если не выполнена, а срок (дата по Москве) уже прошёл. */
export function isTaskOverdue(t: { status: TaskStatus; dueDate: Date | null }, now = new Date()): boolean {
  if (t.status === TaskStatus.DONE || !t.dueDate) return false;
  return t.dueDate.toISOString().slice(0, 10) < mskToday(now);
}

/** Выполнение плана: доля завершённых пунктов среди неотменённых (в процентах), null — если пунктов нет. */
export function planProgress(items: { status: PlanStatus }[]): number | null {
  const active = items.filter((i) => i.status !== PlanStatus.CANCELLED);
  if (!active.length) return null;
  return Math.round((active.filter((i) => i.status === PlanStatus.DONE).length / active.length) * 100);
}

export interface TaskCounters {
  open: number;
  inProgress: number;
  done: number;
  overdue: number;
}

export function countTasks(tasks: { status: TaskStatus; dueDate: Date | null }[], now = new Date()): TaskCounters {
  return {
    open: tasks.filter((t) => t.status !== TaskStatus.DONE).length,
    inProgress: tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
    done: tasks.filter((t) => t.status === TaskStatus.DONE).length,
    overdue: tasks.filter((t) => isTaskOverdue(t, now)).length,
  };
}

/** Кто может менять задачу: руководитель/админ — любые поля; исполнитель и автор — статус и описание. */
export function taskEditScope(opts: { canManage: boolean; isAssignee: boolean; isAuthor: boolean }): 'all' | 'status' | 'none' {
  if (opts.canManage) return 'all';
  if (opts.isAssignee || opts.isAuthor) return 'status';
  return 'none';
}

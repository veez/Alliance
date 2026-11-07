import { countTasks, isTaskOverdue, mskToday, planProgress, taskEditScope } from './wg-logic';

const now = new Date('2026-11-08T22:30:00Z'); // 9 ноября 01:30 по Москве

describe('рабочие группы: правила', () => {
  it('сегодняшняя дата считается по Москве', () => {
    expect(mskToday(now)).toBe('2026-11-09');
  });

  it('задача просрочена только после дня срока и если не выполнена', () => {
    expect(isTaskOverdue({ status: 'TODO', dueDate: new Date('2026-11-08') }, now)).toBe(true);
    expect(isTaskOverdue({ status: 'TODO', dueDate: new Date('2026-11-09') }, now)).toBe(false);
    expect(isTaskOverdue({ status: 'DONE', dueDate: new Date('2026-01-01') }, now)).toBe(false);
    expect(isTaskOverdue({ status: 'IN_PROGRESS', dueDate: null }, now)).toBe(false);
  });

  it('выполнение плана не учитывает отменённые пункты', () => {
    expect(planProgress([])).toBeNull();
    expect(planProgress([{ status: 'CANCELLED' }])).toBeNull();
    expect(planProgress([{ status: 'DONE' }, { status: 'IN_PROGRESS' }, { status: 'CANCELLED' }])).toBe(50);
    expect(planProgress([{ status: 'DONE' }, { status: 'DONE' }, { status: 'PLANNED' }])).toBe(67);
  });

  it('счётчики задач', () => {
    const c = countTasks(
      [
        { status: 'TODO', dueDate: new Date('2026-11-01') },
        { status: 'IN_PROGRESS', dueDate: null },
        { status: 'DONE', dueDate: new Date('2026-10-01') },
      ],
      now,
    );
    expect(c).toEqual({ open: 2, inProgress: 1, done: 1, overdue: 1 });
  });

  it('права на изменение задачи', () => {
    expect(taskEditScope({ canManage: true, isAssignee: false, isAuthor: false })).toBe('all');
    expect(taskEditScope({ canManage: false, isAssignee: true, isAuthor: false })).toBe('status');
    expect(taskEditScope({ canManage: false, isAssignee: false, isAuthor: true })).toBe('status');
    expect(taskEditScope({ canManage: false, isAssignee: false, isAuthor: false })).toBe('none');
  });
});

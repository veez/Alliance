import { ActionIcon, Badge, Button, Card, Divider, Drawer, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconMessage, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { TaskStatus, WgComment, WgTask, WorkingGroupDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, QueryState } from '../../components/common';
import { fmtDateTime, fmtDay, TASK_STATUS } from '../../labels';

const toDay = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null);
const statusOptions = (Object.keys(TASK_STATUS) as TaskStatus[]).map((k) => ({ value: k, label: TASK_STATUS[k].label }));

function TaskModal({ g, task, onClose }: { g: WorkingGroupDetail; task?: WgTask; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      assigneeId: task ? task.assigneeId : g.canManage ? null : (me?.id ?? null),
      planItemId: task?.planItemId ?? null,
      dueDate: task?.dueDate ? dayjs(task.dueDate.slice(0, 10)).toDate() : null,
    },
    validate: { title: (v) => (v.trim().length < 2 ? 'Укажите задачу' : null) },
  });
  const assignees = g.canManage ? g.members : g.members.filter((m) => m.userId === me?.id);
  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    const body = { ...v, dueDate: toDay(v.dueDate) };
    try {
      if (task) await api(`/working-groups/${g.id}/tasks/${task.id}`, { method: 'PATCH', body });
      else await api(`/working-groups/${g.id}/tasks`, { method: 'POST', body });
      await qc.invalidateQueries({ queryKey: ['wg-tasks', g.id] });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      notifyOk(task ? 'Задача сохранена' : v.assigneeId && v.assigneeId !== me?.id ? 'Задача поручена, исполнитель уведомлён' : 'Задача создана');
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });
  return (
    <Modal opened onClose={onClose} title={task ? 'Изменить задачу' : 'Новая задача'} size="lg">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label="Задача" withAsterisk {...form.getInputProps('title')} />
          <Textarea label="Описание" autosize minRows={3} {...form.getInputProps('description')} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Исполнитель" clearable data={assignees.map((m) => ({ value: m.userId, label: m.fullName }))} {...form.getInputProps('assigneeId')} />
            <DateInput label="Срок" valueFormat="DD.MM.YYYY" clearable {...form.getInputProps('dueDate')} />
          </SimpleGrid>
          <Select label="Пункт плана" clearable data={g.plan.map((p) => ({ value: p.id, label: p.title }))} {...form.getInputProps('planItemId')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={busy}>
              {task ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function Comments({ g, task }: { g: WorkingGroupDetail; task: WgTask }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const key = ['wg-comments', task.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<WgComment[]>(`/working-groups/${g.id}/comments?entityType=TASK&entityId=${task.id}`) });
  const canWrite = (!!g.myRole || g.canManage) && g.status === 'ACTIVE';
  const send = async () => {
    setBusy(true);
    try {
      await api(`/working-groups/${g.id}/comments`, { method: 'POST', body: { entityType: 'TASK', entityId: task.id, body } });
      setBody('');
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ['wg-tasks', g.id] });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/working-groups/${g.id}/comments/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ['wg-tasks', g.id] });
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Stack gap="sm">
      <Title order={6}>Обсуждение</Title>
      <QueryState isLoading={q.isLoading} error={q.error}>
        {q.data?.length ? (
          q.data.map((c) => (
            <Card key={c.id} withBorder padding="sm" bg="var(--mantine-color-gray-0)">
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="xs" fw={600}>
                  {c.author.fullName}{' '}
                  <Text span c="dimmed" fw={400}>
                    · {fmtDateTime(c.createdAt)}
                  </Text>
                </Text>
                {c.canDelete && (
                  <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => remove(c.id)} title="Удалить комментарий">
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </Group>
              <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                {c.body}
              </Text>
            </Card>
          ))
        ) : (
          <Text size="sm" c="dimmed">
            Комментариев пока нет.
          </Text>
        )}
      </QueryState>
      {canWrite && (
        <>
          <Textarea placeholder="Написать комментарий…" autosize minRows={2} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button size="xs" disabled={!body.trim()} loading={busy} onClick={send}>
              Отправить
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}

function TaskDrawer({ g, task, onClose, onEdit }: { g: WorkingGroupDetail; task: WgTask; onClose: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const setStatus = async (status: TaskStatus) => {
    try {
      await api(`/working-groups/${g.id}/tasks/${task.id}`, { method: 'PATCH', body: { status } });
      await qc.invalidateQueries({ queryKey: ['wg-tasks', g.id] });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      await qc.invalidateQueries({ queryKey: ['wg-activity'] });
    } catch (e) {
      notifyError(e);
    }
  };
  const remove = async () => {
    try {
      await api(`/working-groups/${g.id}/tasks/${task.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['wg-tasks', g.id] });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={<Text fw={600}>{task.title}</Text>}>
      <Stack>
        {task.canEdit !== 'none' && g.status === 'ACTIVE' ? (
          <SegmentedControl value={task.status} onChange={(v) => setStatus(v as TaskStatus)} data={statusOptions} fullWidth />
        ) : (
          <Badge variant="light" color={TASK_STATUS[task.status].color}>
            {TASK_STATUS[task.status].label}
          </Badge>
        )}
        <SimpleGrid cols={2} spacing="xs">
          <Text size="sm" c="dimmed">Исполнитель</Text>
          <Text size="sm">{task.assignee?.fullName ?? 'не назначен'}</Text>
          <Text size="sm" c="dimmed">Срок</Text>
          <Text size="sm" c={task.overdue ? 'red' : undefined}>
            {task.dueDate ? fmtDay(task.dueDate) : '—'}
            {task.overdue ? ' (просрочена)' : ''}
          </Text>
          <Text size="sm" c="dimmed">Пункт плана</Text>
          <Text size="sm">{task.planItem?.title ?? '—'}</Text>
          <Text size="sm" c="dimmed">Поставил</Text>
          <Text size="sm">
            {task.createdBy.fullName}, {fmtDateTime(task.createdAt)}
          </Text>
          {task.doneAt && (
            <>
              <Text size="sm" c="dimmed">Выполнена</Text>
              <Text size="sm">{fmtDateTime(task.doneAt)}</Text>
            </>
          )}
        </SimpleGrid>
        {task.description && (
          <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
            {task.description}
          </Text>
        )}
        {task.canEdit === 'all' && g.status === 'ACTIVE' && (
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={onEdit}>
              Изменить
            </Button>
            <Button size="xs" variant="subtle" color="red" onClick={remove}>
              Удалить задачу
            </Button>
          </Group>
        )}
        <Divider />
        <Comments g={g} task={task} />
      </Stack>
    </Drawer>
  );
}

function TaskCard({ t, onOpen }: { t: WgTask; onOpen: () => void }) {
  return (
    <Card withBorder padding="sm" onClick={onOpen} style={{ cursor: 'pointer' }} className="hover-card">
      <Text size="sm" fw={500} td={t.status === 'DONE' ? 'line-through' : undefined} c={t.status === 'DONE' ? 'dimmed' : undefined}>
        {t.title}
      </Text>
      <Group justify="space-between" mt={6} gap="xs">
        <Text size="xs" c="dimmed">
          {t.assignee?.fullName ?? 'без исполнителя'}
        </Text>
        <Group gap={6}>
          {t.comments > 0 && (
            <Group gap={2}>
              <IconMessage size={13} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed">
                {t.comments}
              </Text>
            </Group>
          )}
          {t.dueDate && (
            <Badge size="xs" variant="light" color={t.overdue ? 'red' : 'gray'}>
              до {fmtDay(t.dueDate)}
            </Badge>
          )}
        </Group>
      </Group>
    </Card>
  );
}

export function WgTasks({ g }: { g: WorkingGroupDetail }) {
  const [params, setParams] = useSearchParams();
  const [mine, setMine] = useState('all');
  const [editing, setEditing] = useState<WgTask | 'new' | null>(null);
  const q = useQuery({ queryKey: ['wg-tasks', g.id, mine], queryFn: () => api<WgTask[]>(`/working-groups/${g.id}/tasks${mine === 'mine' ? '?mine=true' : ''}`) });
  const openId = params.get('task');
  const open = q.data?.find((t) => t.id === openId);
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('task', id);
    else next.delete('task');
    setParams(next, { replace: true });
  };
  const canCreate = (!!g.myRole || g.canManage) && g.status === 'ACTIVE';
  return (
    <Stack>
      <Group justify="space-between">
        <SegmentedControl
          value={mine}
          onChange={setMine}
          data={[
            { value: 'all', label: 'Все задачи' },
            { value: 'mine', label: 'Мои' },
          ]}
        />
        {canCreate && (
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Задача
          </Button>
        )}
      </Group>
      <QueryState isLoading={q.isLoading} error={q.error}>
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => {
            const list = (q.data ?? []).filter((t) => t.status === s);
            return (
              <Stack key={s} gap="xs">
                <Group gap={6}>
                  <Badge variant="dot" color={TASK_STATUS[s].color}>
                    {TASK_STATUS[s].label}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    {list.length}
                  </Text>
                </Group>
                {list.map((t) => (
                  <TaskCard key={t.id} t={t} onOpen={() => setOpen(t.id)} />
                ))}
                {!list.length && (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                )}
              </Stack>
            );
          })}
        </SimpleGrid>
      </QueryState>
      {open && !editing && <TaskDrawer g={g} task={open} onClose={() => setOpen(null)} onEdit={() => setEditing(open)} />}
      {editing && <TaskModal g={g} task={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

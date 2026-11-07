import { ActionIcon, Badge, Button, Group, Menu, Modal, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api } from '../../api/client';
import type { PlanStatus, WgPlanItem, WorkingGroupDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk } from '../../components/common';
import { fmtDay, PLAN_STATUS } from '../../labels';

const toDate = (v: string | null) => (v ? dayjs(v.slice(0, 10)).toDate() : null);
const toDay = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null);
export const planStatusOptions = (Object.keys(PLAN_STATUS) as PlanStatus[]).map((k) => ({ value: k, label: PLAN_STATUS[k].label }));

function PlanItemModal({ g, item, onClose }: { g: WorkingGroupDetail; item?: WgPlanItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({
    initialValues: {
      title: item?.title ?? '',
      description: item?.description ?? '',
      startDate: toDate(item?.startDate ?? null),
      dueDate: toDate(item?.dueDate ?? null),
      status: item?.status ?? ('PLANNED' as PlanStatus),
      responsibleUserId: item?.responsibleUserId ?? null,
    },
    validate: {
      title: (v) => (v.trim().length < 2 ? 'Укажите название' : null),
      dueDate: (v, all) => (v && all.startDate && v < all.startDate ? 'Срок раньше начала' : null),
    },
  });
  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    const body = { ...v, startDate: toDay(v.startDate), dueDate: toDay(v.dueDate) };
    try {
      if (item) await api(`/working-groups/${g.id}/plan/${item.id}`, { method: 'PATCH', body });
      else await api(`/working-groups/${g.id}/plan`, { method: 'POST', body });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      notifyOk('План обновлён');
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });
  return (
    <Modal opened onClose={onClose} title={item ? 'Пункт плана' : 'Новый пункт плана'} size="lg">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label="Что сделать" withAsterisk {...form.getInputProps('title')} />
          <Textarea label="Описание и ожидаемый результат" autosize minRows={2} {...form.getInputProps('description')} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <DateInput label="Начало" valueFormat="DD.MM.YYYY" clearable {...form.getInputProps('startDate')} />
            <DateInput label="Срок" valueFormat="DD.MM.YYYY" clearable {...form.getInputProps('dueDate')} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select label="Статус" data={planStatusOptions} allowDeselect={false} {...form.getInputProps('status')} />
            <Select label="Ответственный" clearable data={g.members.map((m) => ({ value: m.userId, label: m.fullName }))} {...form.getInputProps('responsibleUserId')} />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={busy}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function WgPlan({ g }: { g: WorkingGroupDetail }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WgPlanItem | 'new' | null>(null);
  const today = dayjs().format('YYYY-MM-DD');
  const setStatus = async (item: WgPlanItem, status: PlanStatus) => {
    try {
      await api(`/working-groups/${g.id}/plan/${item.id}`, { method: 'PATCH', body: { status } });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
    } catch (e) {
      notifyError(e);
    }
  };
  const remove = async (item: WgPlanItem) => {
    try {
      await api(`/working-groups/${g.id}/plan/${item.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Stack>
      {g.canManage && g.status === 'ACTIVE' && (
        <Group justify="flex-end">
          <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Пункт плана
          </Button>
        </Group>
      )}
      {g.plan.length ? (
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пункт плана</Table.Th>
                <Table.Th w={170}>Сроки</Table.Th>
                <Table.Th w={180}>Ответственный</Table.Th>
                <Table.Th w={150}>Статус</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {g.plan.map((p) => {
                const late = p.dueDate && p.dueDate.slice(0, 10) < today && (p.status === 'PLANNED' || p.status === 'IN_PROGRESS');
                const canStatus = g.canManage || p.responsibleUserId === me?.id;
                return (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text size="sm" fw={500} td={p.status === 'CANCELLED' ? 'line-through' : undefined}>
                        {p.title}
                      </Text>
                      {p.description && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {p.description}
                        </Text>
                      )}
                      {p.tasks.open + p.tasks.done > 0 && (
                        <Text size="xs" c="dimmed">
                          Задач: {p.tasks.done} из {p.tasks.open + p.tasks.done} выполнено
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={late ? 'red' : undefined}>
                        {p.startDate ? `${fmtDay(p.startDate)} – ` : ''}
                        {p.dueDate ? fmtDay(p.dueDate) : p.startDate ? '…' : '—'}
                      </Text>
                      {late && (
                        <Text size="xs" c="red">
                          срок прошёл
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{p.responsible?.fullName ?? '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      {canStatus && g.status === 'ACTIVE' ? (
                        <Select size="xs" data={planStatusOptions} value={p.status} allowDeselect={false} onChange={(v) => v && setStatus(p, v as PlanStatus)} />
                      ) : (
                        <Badge variant="light" color={PLAN_STATUS[p.status].color}>
                          {PLAN_STATUS[p.status].label}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {g.canManage && (
                        <Menu position="bottom-end">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" title="Действия">
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => setEditing(p)}>Изменить</Menu.Item>
                            <Menu.Item color="red" onClick={() => remove(p)}>
                              Удалить
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text c="dimmed">План работы ещё не составлен{g.canManage ? ' — добавьте первый пункт.' : '.'}</Text>
      )}
      {editing && <PlanItemModal g={g} item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

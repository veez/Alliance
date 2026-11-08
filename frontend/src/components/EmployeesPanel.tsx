import { ActionIcon, Badge, Button, Checkbox, Group, Modal, MultiSelect, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useResponsibilityAreas, useWorkingGroupsBrief } from '../api/hooks';
import type { Employee } from '../api/types';
import { notifyError, notifyOk, QueryState } from './common';
import { ALLIANCE_TAG } from '../labels';

interface FormValues {
  fullName: string;
  position: string;
  email: string;
  phone: string;
  vk: string;
  telegram: string;
  allianceTags: string[];
  isPrimary: boolean;
  notes: string;
  pdConsent: boolean;
  hideMessengers: boolean;
  areaIds: string[];
  workingGroupIds: string[];
  hideEmail: boolean;
  hidePhone: boolean;
  hideFromDirectory: boolean;
}

function EmployeeModal({ orgId, employee, onClose }: { orgId: string; employee: Employee | null | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const areas = useResponsibilityAreas();
  const wgs = useWorkingGroupsBrief();
  const wgArea = areas.data?.find((a) => a.code === 'WORKING_GROUP');
  const form = useForm<FormValues>({
    initialValues: {
      fullName: employee?.fullName ?? '',
      position: employee?.position ?? '',
      email: employee?.email ?? '',
      phone: employee?.phone ?? '',
      vk: employee?.vk ?? '',
      telegram: employee?.telegram ?? '',
      allianceTags: employee?.allianceTags ?? [],
      isPrimary: !!employee?.isPrimary,
      notes: employee?.notes ?? '',
      pdConsent: !!employee?.pdConsentAt,
      hideMessengers: !!employee?.contactPrivacy?.hideMessengers,
      areaIds: [...new Set(employee?.responsibilities.map((r) => r.area.id) ?? [])],
      workingGroupIds: employee?.responsibilities.filter((r) => r.workingGroup).map((r) => r.workingGroup!.id) ?? [],
      hideEmail: !!employee?.contactPrivacy?.hideEmail,
      hidePhone: !!employee?.contactPrivacy?.hidePhone,
      hideFromDirectory: !!employee?.contactPrivacy?.hideFromDirectory,
    },
    validate: {
      fullName: (v) => (v.trim().length >= 2 ? null : 'Укажите ФИО'),
      email: (v) => (!v || /^\S+@\S+\.\S+$/.test(v) ? null : 'Некорректный email'),
    },
  });
  const wgSelected = !!wgArea && form.values.areaIds.includes(wgArea.id);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const responsibilities = v.areaIds.flatMap((areaId) =>
        areaId === wgArea?.id && v.workingGroupIds.length ? v.workingGroupIds.map((workingGroupId) => ({ areaId, workingGroupId })) : [{ areaId }],
      );
      const body = {
        fullName: v.fullName,
        position: v.position,
        email: v.email,
        phone: v.phone,
        vk: v.vk,
        telegram: v.telegram,
        allianceTags: v.allianceTags,
        isPrimary: v.isPrimary,
        notes: v.notes,
        pdConsent: v.pdConsent,
        responsibilities,
        contactPrivacy: { hideEmail: v.hideEmail, hidePhone: v.hidePhone, hideMessengers: v.hideMessengers, hideFromDirectory: v.hideFromDirectory },
      };
      return employee
        ? api(`/organizations/${orgId}/employees/${employee.id}`, { method: 'PATCH', body })
        : api(`/organizations/${orgId}/employees`, { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees', orgId] });
      notifyOk(employee ? 'Сотрудник обновлён' : 'Сотрудник добавлен');
      onClose();
    },
    onError: notifyError,
  });

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="ФИО" withAsterisk {...form.getInputProps('fullName')} />
          <TextInput label="Должность" {...form.getInputProps('position')} />
          <TextInput label="Email" {...form.getInputProps('email')} />
          <TextInput label="Телефон" {...form.getInputProps('phone')} />
          <TextInput label="ВКонтакте" placeholder="https://vk.com/..." {...form.getInputProps('vk')} />
          <TextInput label="Telegram" placeholder="@username" {...form.getInputProps('telegram')} />
        </SimpleGrid>
        <MultiSelect label="Роль в Альянсе" data={Object.entries(ALLIANCE_TAG).map(([value, label]) => ({ value, label }))} {...form.getInputProps('allianceTags')} />
        <Group gap="xl">
          <Checkbox label="Главный контакт организации" {...form.getInputProps('isPrimary', { type: 'checkbox' })} />
          <Checkbox label="Есть согласие на обработку персональных данных" {...form.getInputProps('pdConsent', { type: 'checkbox' })} />
        </Group>
        <Textarea label="Примечание" autosize minRows={1} {...form.getInputProps('notes')} />
        <Stack gap={6}>
          <Text size="sm" fw={500}>Видимость в справочнике контактов</Text>
          <Checkbox label="Не показывать сотрудника другим членам Альянса" {...form.getInputProps('hideFromDirectory', { type: 'checkbox' })} />
          {!form.values.hideFromDirectory && (
            <Group gap="xl">
              <Checkbox label="Скрыть email" {...form.getInputProps('hideEmail', { type: 'checkbox' })} />
              <Checkbox label="Скрыть телефон" {...form.getInputProps('hidePhone', { type: 'checkbox' })} />
              <Checkbox label="Скрыть мессенджеры" {...form.getInputProps('hideMessengers', { type: 'checkbox' })} />
            </Group>
          )}
        </Stack>
        <MultiSelect
          label="Области ответственности"
          description="Эти контакты увидят администратор и секретарь для рабочих коммуникаций"
          data={(areas.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
          {...form.getInputProps('areaIds')}
        />
        {wgSelected && (
          <MultiSelect
            label="Рабочие группы"
            data={(wgs.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
            {...form.getInputProps('workingGroupIds')}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" loading={save.isPending}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function EmployeesPanel({ orgId, editable }: { orgId: string; editable: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined); // undefined — закрыто, null — новый
  const list = useQuery({ queryKey: ['employees', orgId], queryFn: () => api<Employee[]>(`/organizations/${orgId}/employees`) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/organizations/${orgId}/employees/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees', orgId] });
      notifyOk('Сотрудник удалён');
    },
    onError: notifyError,
  });

  const confirmRemove = (e: Employee) =>
    modals.openConfirmModal({
      title: 'Удалить сотрудника?',
      children: <Text size="sm">{e.fullName} будет удалён(а) из списка сотрудников организации.</Text>,
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(e.id),
    });

  return (
    <Stack>
      {editable && (
        <Group justify="flex-end">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
            Добавить сотрудника
          </Button>
        </Group>
      )}
      <QueryState isLoading={list.isLoading} error={list.error}>
        {list.data?.length ? (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Сотрудник</Table.Th>
                  <Table.Th>Контакты</Table.Th>
                  <Table.Th>Области ответственности</Table.Th>
                  {editable && <Table.Th w={80} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.data.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {e.fullName}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {e.position}
                      </Text>
                      <Group gap={4} mt={2}>
                        {e.isPrimary && (
                          <Badge size="xs" color="teal">
                            Главный контакт
                          </Badge>
                        )}
                        {e.allianceTags.map((t) => (
                          <Badge key={t} size="xs" variant="light" color="grape">
                            {ALLIANCE_TAG[t] ?? t}
                          </Badge>
                        ))}
                        {!e.pdConsentAt && (
                          <Badge size="xs" variant="outline" color="gray">
                            Нет согласия на ПДн
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{e.email}</Text>
                      <Text size="xs" c="dimmed">
                        {e.phone}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[e.telegram, e.vk].filter(Boolean).join(' · ')}
                      </Text>
                      {e.notes && (
                        <Text size="xs" c="dimmed" className="pre-wrap">
                          {e.notes}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {e.responsibilities.map((r) => (
                          <Badge key={r.id} variant="light" size="sm" color={r.workingGroup ? 'indigo' : 'brand'}>
                            {r.workingGroup ? r.workingGroup.name : r.area.name}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    {editable && (
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <ActionIcon variant="subtle" onClick={() => setEditing(e)} aria-label="Изменить">
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" onClick={() => confirmRemove(e)} aria-label="Удалить">
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text c="dimmed" size="sm">
            Сотрудники не добавлены.
          </Text>
        )}
      </QueryState>
      <Modal opened={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? 'Сотрудник' : 'Новый сотрудник'} size="lg">
        {editing !== undefined && <EmployeeModal orgId={orgId} employee={editing} onClose={() => setEditing(undefined)} />}
      </Modal>
    </Stack>
  );
}

import { Badge, Button, Card, Group, Modal, Progress, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus, IconUsersGroup } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { AdminUser, Page, WorkingGroupListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { WG_ROLE } from '../../labels';

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const users = useQuery({ queryKey: ['admin-users', 'wg-lead'], queryFn: () => api<Page<AdminUser>>('/admin/users?pageSize=200&status=ACTIVE') });
  const form = useForm({
    initialValues: { name: '', goals: '', description: '', leadUserId: null as string | null },
    validate: { name: (v) => (v.trim().length < 3 ? 'Укажите название' : null) },
  });
  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    try {
      const g = await api<{ id: string }>('/working-groups', { method: 'POST', body: { ...v, leadUserId: v.leadUserId ?? undefined } });
      await qc.invalidateQueries({ queryKey: ['working-groups'] });
      await qc.invalidateQueries({ queryKey: ['working-groups-brief'] });
      notifyOk('Рабочая группа создана');
      navigate(`/working-groups/${g.id}`);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });
  const leadOptions = (users.data?.items ?? [])
    .filter((u) => u.organization?.status === 'MEMBER')
    .map((u) => ({ value: u.id, label: `${u.fullName}${u.organization ? ` · ${u.organization.shortName || u.organization.name}` : ''}` }));
  return (
    <Modal opened onClose={onClose} title="Новая рабочая группа" size="lg">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label="Название" withAsterisk placeholder="РГ по …" {...form.getInputProps('name')} />
          <Textarea label="Цели" autosize minRows={2} {...form.getInputProps('goals')} />
          <Textarea label="Описание" autosize minRows={2} {...form.getInputProps('description')} />
          <Select label="Руководитель" placeholder="Можно назначить позже" searchable clearable data={leadOptions} {...form.getInputProps('leadUserId')} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={busy}>
              Создать
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export function WorkingGroupsPage() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['working-groups'], queryFn: () => api<WorkingGroupListItem[]>('/working-groups') });
  const active = (q.data ?? []).filter((g) => g.status === 'ACTIVE');
  const archived = (q.data ?? []).filter((g) => g.status === 'ARCHIVED');
  const card = (g: WorkingGroupListItem) => (
    <Card key={g.id} withBorder padding="lg" component={Link} to={`/working-groups/${g.id}`} className="hover-card">
      <Stack gap="xs" h="100%">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Title order={4}>{g.name}</Title>
          {g.myRole && (
            <Badge variant="light" color={g.myRole === 'LEAD' ? 'grape' : 'teal'} style={{ flexShrink: 0 }}>
              {g.myRole === 'LEAD' ? 'Вы руководитель' : 'Вы участник'}
            </Badge>
          )}
        </Group>
        {g.goals && (
          <Text size="sm" c="dimmed" lineClamp={3}>
            {g.goals}
          </Text>
        )}
        <div style={{ flex: 1 }} />
        <Text size="sm">
          {WG_ROLE.LEAD}: {g.leads.map((l) => l.fullName).join(', ') || 'не назначен'}
        </Text>
        <Group gap="lg">
          <Text size="sm" c="dimmed">
            Участников: {g.membersCount}
          </Text>
          <Text size="sm" c="dimmed">
            Открытых задач: {g.tasks.open}
            {g.tasks.overdue > 0 && (
              <Text span c="red">
                {' '}
                (просрочено {g.tasks.overdue})
              </Text>
            )}
          </Text>
        </Group>
        {g.progress !== null && (
          <div>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Выполнение плана
              </Text>
              <Text size="xs" fw={500}>
                {g.progress}%
              </Text>
            </Group>
            <Progress value={g.progress} size="sm" mt={2} />
          </div>
        )}
      </Stack>
    </Card>
  );
  return (
    <>
      <PageHeader
        title="Рабочие группы"
        description="Планы, задачи, протоколы и документы рабочих групп Альянса."
        actions={
          can('wg.manage') && (
            <Button leftSection={<IconPlus size={18} />} onClick={() => setCreating(true)}>
              Новая группа
            </Button>
          )
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error}>
        {active.length ? (
          <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>{active.map(card)}</SimpleGrid>
        ) : (
          <Stack align="center" py="xl" c="dimmed">
            <IconUsersGroup size={40} />
            <Text>Рабочих групп пока нет.</Text>
          </Stack>
        )}
        {archived.length > 0 && (
          <>
            <Title order={4} mt="xl" mb="sm" c="dimmed">
              Архив
            </Title>
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>{archived.map(card)}</SimpleGrid>
          </>
        )}
      </QueryState>
      {creating && <CreateGroupModal onClose={() => setCreating(false)} />}
    </>
  );
}

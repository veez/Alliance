import { ActionIcon, Alert, Anchor, Badge, Button, Card, Grid, Group, Menu, Modal, Progress, Select, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDots, IconEdit, IconFilePlus, IconLogout, IconUserPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { WorkingGroupDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { EVENT_FORMAT, fmtDateTime, WG_ROLE } from '../../labels';
import { ProtocolsTab } from '../events/ProtocolsTab';
import { WgFiles } from './WgFiles';
import { WgPlan } from './WgPlan';
import { WgTasks } from './WgTasks';

function EditGroupModal({ g, onClose }: { g: WorkingGroupDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({ initialValues: { name: g.name, goals: g.goals ?? '', description: g.description ?? '' } });
  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    try {
      await api(`/working-groups/${g.id}`, { method: 'PATCH', body: v });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      await qc.invalidateQueries({ queryKey: ['working-groups'] });
      notifyOk('Сохранено');
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });
  return (
    <Modal opened onClose={onClose} title="Рабочая группа" size="lg">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label="Название" withAsterisk {...form.getInputProps('name')} />
          <Textarea label="Цели" autosize minRows={2} {...form.getInputProps('goals')} />
          <Textarea label="Описание" autosize minRows={3} {...form.getInputProps('description')} />
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

function AddMemberModal({ g, onClose }: { g: WorkingGroupDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cands = useQuery({ queryKey: ['wg-candidates', g.id], queryFn: () => api<{ id: string; fullName: string; organization: string | null }[]>(`/working-groups/${g.id}/candidates`) });
  const add = async () => {
    setBusy(true);
    try {
      await api(`/working-groups/${g.id}/members`, { method: 'POST', body: { userId } });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      await qc.invalidateQueries({ queryKey: ['wg-candidates', g.id] });
      notifyOk('Участник добавлен и получил уведомление');
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened onClose={onClose} title="Добавить участника">
      <Stack>
        <Select
          label="Представитель организации — члена Альянса"
          searchable
          data={(cands.data ?? []).map((c) => ({ value: c.id, label: `${c.fullName}${c.organization ? ` · ${c.organization}` : ''}` }))}
          value={userId}
          onChange={setUserId}
          nothingFoundMessage="Никого не найдено"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!userId} loading={busy} onClick={add}>
            Добавить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Overview({ g }: { g: WorkingGroupDetail }) {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['working-group', g.id] }), qc.invalidateQueries({ queryKey: ['working-groups'] })]);
  const memberAction = async (userId: string, action: 'remove' | 'lead' | 'member') => {
    try {
      if (action === 'remove') await api(`/working-groups/${g.id}/members/${userId}`, { method: 'DELETE' });
      else await api(`/working-groups/${g.id}/members/${userId}`, { method: 'PATCH', body: { role: action === 'lead' ? 'LEAD' : 'MEMBER' } });
      await refresh();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Stack>
          <Card withBorder padding="lg">
            <Title order={5} mb="xs">
              Цели
            </Title>
            <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
              {g.goals || '—'}
            </Text>
            {g.description && (
              <Text size="sm" c="dimmed" mt="sm" style={{ whiteSpace: 'pre-line' }}>
                {g.description}
              </Text>
            )}
          </Card>
          <Card withBorder padding="lg">
            <Group justify="space-between" mb="sm">
              <Title order={5}>Участники ({g.members.length})</Title>
              {g.canManage && g.status === 'ACTIVE' && (
                <Button size="xs" variant="light" leftSection={<IconUserPlus size={14} />} onClick={() => setAdding(true)}>
                  Добавить
                </Button>
              )}
            </Group>
            <Stack gap={6}>
              {g.members.map((m) => (
                <Group key={m.userId} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={m.role === 'LEAD' ? 600 : undefined}>
                      {m.fullName}
                      {m.userId === me?.id && (
                        <Text span c="dimmed">
                          {' '}
                          (вы)
                        </Text>
                      )}
                    </Text>
                    {m.organization && (
                      <Anchor component={Link} to={`/organizations/${m.organization.id}`} size="xs" c="dimmed">
                        {m.organization.name}
                      </Anchor>
                    )}
                  </div>
                  <Group gap={4} wrap="nowrap">
                    {m.role === 'LEAD' && (
                      <Badge variant="light" color="grape" size="sm">
                        {WG_ROLE.LEAD}
                      </Badge>
                    )}
                    {g.canManage && m.userId !== me?.id && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" title="Действия">
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {can('wg.manage') &&
                            (m.role === 'LEAD' ? (
                              <Menu.Item onClick={() => memberAction(m.userId, 'member')}>Снять роль руководителя</Menu.Item>
                            ) : (
                              <Menu.Item onClick={() => memberAction(m.userId, 'lead')}>Назначить руководителем</Menu.Item>
                            ))}
                          <Menu.Item color="red" onClick={() => memberAction(m.userId, 'remove')}>
                            Исключить из группы
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Group>
                </Group>
              ))}
              {!g.members.length && (
                <Text size="sm" c="dimmed">
                  В группе пока нет участников.
                </Text>
              )}
            </Stack>
          </Card>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Stack>
          <Card withBorder padding="lg">
            <Title order={5} mb="sm">
              Ход работы
            </Title>
            {g.progress !== null ? (
              <>
                <Group justify="space-between">
                  <Text size="sm">Выполнение плана</Text>
                  <Text size="sm" fw={600}>
                    {g.progress}%
                  </Text>
                </Group>
                <Progress value={g.progress} mt={4} mb="sm" />
              </>
            ) : (
              <Text size="sm" c="dimmed" mb="sm">
                План работы ещё не составлен.
              </Text>
            )}
            <Text size="sm">
              Задач в работе: {g.tasks.open} · выполнено: {g.tasks.done}
            </Text>
            {g.tasks.overdue > 0 && (
              <Text size="sm" c="red">
                Просрочено задач: {g.tasks.overdue}
              </Text>
            )}
            <Text size="sm">Опубликовано протоколов: {g.publishedProtocols}</Text>
          </Card>
          <Card withBorder padding="lg">
            <Title order={5} mb="sm">
              Ближайшие заседания
            </Title>
            {g.upcomingEvents.length ? (
              <Stack gap={6}>
                {g.upcomingEvents.map((e) => (
                  <div key={e.id}>
                    <Anchor component={Link} to={`/events/${e.id}`} size="sm">
                      {e.title}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {fmtDateTime(e.startsAt)} МСК · {EVENT_FORMAT[e.format]}
                    </Text>
                  </div>
                ))}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                Заседаний не запланировано. Их назначает секретариат Альянса.
              </Text>
            )}
          </Card>
        </Stack>
      </Grid.Col>
      {adding && <AddMemberModal g={g} onClose={() => setAdding(false)} />}
    </Grid>
  );
}

export function WorkingGroupPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['working-group', id], queryFn: () => api<WorkingGroupDetail>(`/working-groups/${id}`) });
  const g = q.data;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['working-group', id] }), qc.invalidateQueries({ queryKey: ['working-groups'] }), qc.invalidateQueries({ queryKey: ['wg-activity'] })]);
  const join = async () => {
    try {
      await api(`/working-groups/${id}/join`, { method: 'POST' });
      await refresh();
      notifyOk('Вы вступили в рабочую группу');
    } catch (e) {
      notifyError(e);
    }
  };
  const leave = async () => {
    try {
      await api(`/working-groups/${id}/members/${me!.id}`, { method: 'DELETE' });
      await refresh();
      notifyOk('Вы вышли из рабочей группы');
    } catch (e) {
      notifyError(e);
    }
  };
  const archive = async (status: 'ACTIVE' | 'ARCHIVED') => {
    try {
      await api(`/working-groups/${id}`, { method: 'PATCH', body: { status } });
      await refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      {g && (
        <>
          <Anchor component={Link} to="/working-groups" size="sm">
            ← Все рабочие группы
          </Anchor>
          <PageHeader
            title={g.name}
            description={
              <Group gap={6} mt={4}>
                {g.myRole && (
                  <Badge variant="light" color={g.myRole === 'LEAD' ? 'grape' : 'teal'}>
                    {g.myRole === 'LEAD' ? 'Вы руководитель' : 'Вы участник'}
                  </Badge>
                )}
                {g.status === 'ARCHIVED' && <Badge color="gray">Архив</Badge>}
              </Group>
            }
            actions={
              <>
                {g.canJoin && <Button onClick={join}>Вступить в группу</Button>}
                {g.canManage && (
                  <Button variant="light" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
                    Изменить
                  </Button>
                )}
                {(g.myRole || can('wg.manage')) && (
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="default" size="lg" title="Ещё">
                        <IconDots size={18} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {g.myRole && (
                        <Menu.Item leftSection={<IconLogout size={14} />} color="red" onClick={leave}>
                          Выйти из группы
                        </Menu.Item>
                      )}
                      {can('wg.manage') && (
                        <Menu.Item onClick={() => archive(g.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')}>
                          {g.status === 'ACTIVE' ? 'Перенести в архив' : 'Вернуть из архива'}
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
              </>
            }
          />
          {!g.fullAccess && (
            <Alert color="blue" mb="md">
              Задачи, обсуждения и документы группы доступны её участникам. Вступите в группу, чтобы участвовать в работе.
            </Alert>
          )}
          <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'overview' })} keepMounted={false}>
            <Tabs.List mb="md">
              <Tabs.Tab value="overview">Обзор</Tabs.Tab>
              <Tabs.Tab value="plan">План работы</Tabs.Tab>
              {g.fullAccess && (
                <Tabs.Tab value="tasks" rightSection={g.tasks.open ? <Badge size="xs" variant="light">{g.tasks.open}</Badge> : null}>
                  Задачи
                </Tabs.Tab>
              )}
              <Tabs.Tab value="protocols">Протоколы</Tabs.Tab>
              {g.fullAccess && <Tabs.Tab value="files">Документы</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="overview">
              <Overview g={g} />
            </Tabs.Panel>
            <Tabs.Panel value="plan">
              <WgPlan g={g} />
            </Tabs.Panel>
            <Tabs.Panel value="tasks">
              <WgTasks g={g} />
            </Tabs.Panel>
            <Tabs.Panel value="protocols">
              <Stack>
                {g.canManage && (
                  <Group justify="flex-end">
                    <Button variant="light" leftSection={<IconFilePlus size={16} />} component={Link} to={`/protocols/new?workingGroupId=${g.id}`}>
                      Протокол заседания
                    </Button>
                  </Group>
                )}
                <ProtocolsTab workingGroupId={g.id} />
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="files">
              <WgFiles g={g} />
            </Tabs.Panel>
          </Tabs>
          {editing && <EditGroupModal g={g} onClose={() => setEditing(false)} />}
        </>
      )}
    </QueryState>
  );
}

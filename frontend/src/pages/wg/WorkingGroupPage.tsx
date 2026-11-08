import { ActionIcon, Alert, Anchor, Badge, Button, Card, Grid, Group, Menu, Modal, Progress, Select, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDots, IconEdit, IconFilePlus, IconLogout, IconUserPlus, IconCalendarPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { WgRole, WorkingGroupDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, PageHeader, QueryState, DemoBadge } from '../../components/common';
import { EVENT_FORMAT, fmtDateTime, WG_ROLE } from '../../labels';
import { EventFormModal } from '../events/EventShared';
import { EventMonth } from '../events/EventsPage';
import { ProtocolsTab } from '../events/ProtocolsTab';
import { WgFiles } from './WgFiles';
import { WgPlan } from './WgPlan';
import { WgTasks } from './WgTasks';

function EditGroupModal({ g, onClose }: { g: WorkingGroupDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const form = useForm({ initialValues: { name: g.name, goals: g.goals ?? '', description: g.description ?? '', leaderNames: g.leaderNames ?? '', chatVk: g.chatVk ?? '', chatTelegram: g.chatTelegram ?? '', chatMax: g.chatMax ?? '' } });
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
          <TextInput label="Руководители (если нет аккаунта)" {...form.getInputProps('leaderNames')} />
          <TextInput label="Чат ВКонтакте" {...form.getInputProps('chatVk')} />
          <TextInput label="Чат Telegram" {...form.getInputProps('chatTelegram')} />
          <TextInput label="Чат MAX" {...form.getInputProps('chatMax')} />
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
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cands = useQuery({
    queryKey: ['wg-candidates', g.id],
    queryFn: () => api<{ id: string; kind: 'user' | 'employee'; account: 'ACTIVE' | 'INVITED' | null; fullName: string; organization: string | null }[]>(`/working-groups/${g.id}/candidates`),
  });
  const add = async () => {
    const [kind, id] = value!.split(':');
    setBusy(true);
    try {
      await api(`/working-groups/${g.id}/members`, { method: 'POST', body: kind === 'user' ? { userId: id } : { employeeId: id } });
      await qc.invalidateQueries({ queryKey: ['working-group', g.id] });
      await qc.invalidateQueries({ queryKey: ['wg-candidates', g.id] });
      notifyOk('Участник добавлен');
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const note = (a: 'ACTIVE' | 'INVITED' | null) => (a === 'ACTIVE' ? '' : a === 'INVITED' ? ' · ещё не вошёл' : ' · нет учётной записи');
  return (
    <Modal opened onClose={onClose} title="Добавить участника">
      <Stack>
        <Select
          label="Сотрудник организации — члена или партнёра Альянса"
          description="Можно выбрать и тех, у кого ещё нет доступа к порталу. Назначить руководителем можно после добавления."
          searchable
          data={(cands.data ?? []).map((c) => ({ value: `${c.kind}:${c.id}`, label: `${c.fullName}${c.organization ? ` · ${c.organization}` : ''}${note(c.account)}` }))}
          value={value}
          onChange={setValue}
          nothingFoundMessage="Никого не найдено"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!value} loading={busy} onClick={add}>
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
  // Единый список: руководители всегда сверху, в том числе записанные только текстом
  type Row = { key: string; id: string; path: 'members' | 'employee-members' | null; fullName: string; organization: { id: string; name: string } | null; role: WgRole; note: string | null };
  const textLeaders = (g.leaderNames ?? '').split(/\s*[+;]\s*/).filter(Boolean);
  const rows: Row[] = [
    ...g.members.map((m): Row => ({ key: m.userId, id: m.userId, path: 'members', fullName: m.fullName, organization: m.organization, role: m.role, note: m.account === 'INVITED' ? 'ещё не вошёл' : null })),
    ...g.employeeMembers.map((m): Row => ({ key: m.employeeId, id: m.employeeId, path: 'employee-members', fullName: m.fullName, organization: m.organization, role: m.role, note: 'нет учётной записи' })),
    ...textLeaders.map((name): Row => ({ key: name, id: name, path: null, fullName: name, organization: null, role: 'LEAD', note: 'нет в списках сотрудников' })),
  ].sort((a, b) => Number(b.role === 'LEAD') - Number(a.role === 'LEAD'));
  const memberAction = async (userId: string, action: 'remove' | 'lead' | 'member', path: 'members' | 'employee-members' = 'members') => {
    try {
      if (action === 'remove') await api(`/working-groups/${g.id}/${path}/${userId}`, { method: 'DELETE' });
      else await api(`/working-groups/${g.id}/${path}/${userId}`, { method: 'PATCH', body: { role: action === 'lead' ? 'LEAD' : 'MEMBER' } });
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
            {(g.chatVk || g.chatTelegram || g.chatMax) && (
              <Group gap="md" mt="sm">
                {([['Чат ВКонтакте', g.chatVk], ['Чат Telegram', g.chatTelegram], ['Чат MAX', g.chatMax]] as const).map(
                  ([label, url]) =>
                    url && (
                      <Anchor key={label} href={url} target="_blank" rel="noopener noreferrer" size="sm">
                        {label}
                      </Anchor>
                    ),
                )}
              </Group>
            )}
          </Card>
          <Card withBorder padding="lg">
            <Group justify="space-between" mb="sm">
              <Title order={5}>Участники ({rows.length})</Title>
              {g.canManage && g.status === 'ACTIVE' && (
                <Button size="xs" variant="light" leftSection={<IconUserPlus size={14} />} onClick={() => setAdding(true)}>
                  Добавить
                </Button>
              )}
            </Group>
            <Stack gap={6}>
              {rows.map((m) => (
                <Group key={m.key} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={m.role === 'LEAD' ? 600 : undefined}>
                      {m.fullName}
                      {m.id === me?.id && (
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
                    {m.note && (
                      <Badge variant="outline" color="gray" size="sm">
                        {m.note}
                      </Badge>
                    )}
                    {m.role === 'LEAD' && (
                      <Badge variant="light" color="grape" size="sm">
                        {WG_ROLE.LEAD}
                      </Badge>
                    )}
                    {g.canManage && m.path && m.id !== me?.id && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" title="Действия">
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {can('wg.manage') &&
                            (m.role === 'LEAD' ? (
                              <Menu.Item onClick={() => memberAction(m.id, 'member', m.path!)}>Снять роль руководителя</Menu.Item>
                            ) : (
                              <Menu.Item onClick={() => memberAction(m.id, 'lead', m.path!)}>Назначить руководителем</Menu.Item>
                            ))}
                          <Menu.Item color="red" onClick={() => memberAction(m.id, 'remove', m.path!)}>
                            Исключить из группы
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Group>
                </Group>
              ))}
              {!rows.length && (
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
  const [planningMeeting, setPlanningMeeting] = useState(false);
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
          {!g.isBoard && (
            <Anchor component={Link} to="/working-groups" size="sm">
              ← Все рабочие группы
            </Anchor>
          )}
          <PageHeader
            title={g.name}
            description={
              <Group gap={6} mt={4}>
                <DemoBadge show={g.isDemo} />
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
                {g.isBoard && can('events.manage') && (
                  <Button leftSection={<IconCalendarPlus size={16} />} onClick={() => setPlanningMeeting(true)}>
                    Новое заседание
                  </Button>
                )}
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
              {g.isBoard && <Tabs.Tab value="calendar">Календарь</Tabs.Tab>}
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
            <Tabs.Panel value="calendar">
              <EventMonth workingGroupId={g.id} />
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
          {planningMeeting && <EventFormModal opened presetGroupId={g.id} onClose={() => setPlanningMeeting(false)} />}
        </>
      )}
    </QueryState>
  );
}

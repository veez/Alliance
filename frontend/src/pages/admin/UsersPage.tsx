import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Menu,
  Modal,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconCopy, IconDots, IconLock, IconMailForward, IconSearch, IconShieldCheck, IconShieldOff, IconUserPlus } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../../api/client';
import type { AdminUser, Organization, Page, SystemRole } from '../../api/types';
import { useAuth, useMe } from '../../auth/AuthContext';
import { InviteLink, InviteResult } from '../../components/InviteLink';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { fmtDateTime, ORG_STATUS, SYSTEM_ROLE, USER_STATUS } from '../../labels';

const PAGE_SIZE = 25;
const roleOptions = (Object.keys(SYSTEM_ROLE) as SystemRole[]).map((r) => ({ value: r, label: SYSTEM_ROLE[r] }));

function useOrgOptions() {
  const q = useQuery({
    queryKey: ['organizations', 'all-brief'],
    queryFn: () => api<Page<Organization>>('/organizations?pageSize=200'),
    staleTime: 60_000,
  });
  return (q.data?.items ?? []).map((o) => ({ value: o.id, label: `${o.shortName || o.name} · ${ORG_STATUS[o.status].label}` }));
}

function InviteModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const orgOptions = useOrgOptions();
  const { can } = useAuth();
  const [link, setLink] = useState<InviteResult | null>(null);
  const form = useForm({
    initialValues: { email: '', fullName: '', position: '', systemRole: 'USER' as SystemRole, organizationId: null as string | null },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Некорректный email'),
      fullName: (v) => (v.trim().length >= 2 ? null : 'Укажите ФИО'),
      organizationId: (v, all) => (all.systemRole === 'USER' && !v ? 'Выберите организацию' : null),
    },
  });
  const invite = useMutation({
    mutationFn: (v: typeof form.values) => api<InviteResult>('/admin/users/invite', { method: 'POST', body: { ...v, organizationId: v.organizationId ?? undefined } }),
    onSuccess: (res) => {
      setLink(res);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: notifyError,
  });
  const close = () => {
    form.reset();
    setLink(null);
    onClose();
  };
  return (
    <Modal opened={opened} onClose={close} title="Пригласить пользователя" size="lg">
      {link ? (
        <Stack>
          <InviteLink result={link} />
          <Group justify="flex-end">
            <Button onClick={close}>Готово</Button>
          </Group>
        </Stack>
      ) : (
        <form onSubmit={form.onSubmit((v) => invite.mutate(v))}>
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Email" withAsterisk {...form.getInputProps('email')} />
              <TextInput label="ФИО" withAsterisk {...form.getInputProps('fullName')} />
              <TextInput label="Должность" {...form.getInputProps('position')} />
              {can('roles.manage') && <Select label="Системная роль" data={roleOptions} allowDeselect={false} {...form.getInputProps('systemRole')} />}
            </SimpleGrid>
            <Select
              label="Организация"
              description="Учётная запись организации: голосует от её имени. Руководитель может передать доступ доверенному сотруднику."
              searchable
              clearable
              data={orgOptions}
              {...form.getInputProps('organizationId')}
            />
            {form.values.systemRole !== 'USER' && (
              <Alert color="blue">При первом входе пользователь должен будет настроить двухфакторную аутентификацию.</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Отмена
              </Button>
              <Button type="submit" loading={invite.isPending} leftSection={<IconUserPlus size={16} />}>
                Пригласить
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}

function EditDrawer({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const orgOptions = useOrgOptions();
  const form = useForm({
    initialValues: {
      fullName: user?.fullName ?? '',
      position: user?.position ?? '',
      phone: user?.phone ?? '',
      systemRole: user?.systemRole ?? ('USER' as SystemRole),
      canViewAll: user?.canViewAll ?? false,
      organizationId: user?.organizationId ?? null,
    },
  });
  const save = useMutation({
    mutationFn: (v: typeof form.values) => api(`/admin/users/${user!.id}`, { method: 'PATCH', body: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      notifyOk('Сохранено');
      onClose();
    },
    onError: notifyError,
  });
  if (!user) return null;
  const self = user.id === me.id;
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label="Email" value={user.email} readOnly />
        <TextInput label="ФИО" {...form.getInputProps('fullName')} />
        <TextInput label="Должность" {...form.getInputProps('position')} />
        <TextInput label="Телефон" {...form.getInputProps('phone')} />
        <Select label="Системная роль" data={roleOptions} allowDeselect={false} disabled={self} {...form.getInputProps('systemRole')} />
        <Select label="Организация" searchable clearable data={orgOptions} {...form.getInputProps('organizationId')} />
        <Switch
          label="Особые права: видеть всё"
          description="Чтение всех голосований, взносов, протоколов и карточек — как у секретаря, без права изменения"
          {...form.getInputProps('canViewAll', { type: 'checkbox' })}
        />
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

export function UsersPage() {
  const qc = useQueryClient();
  const me = useMe();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resentLink, setResentLink] = useState<InviteResult | null>(null);
  const { can } = useAuth();
  const manage = can('users.manage');

  const list = useQuery({
    queryKey: ['admin-users', debounced, role, status, page],
    queryFn: () => api<Page<AdminUser>>(`/admin/users${qs({ search: debounced, systemRole: role, status, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) =>
      api<Partial<InviteResult> | undefined>(path, { method: body ? 'PATCH' : 'POST', body }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      if (res?.inviteLink) setResentLink({ inviteLink: res.inviteLink, emailSent: !!res.emailSent });
      else notifyOk(vars.path.endsWith('reset-2fa') ? '2FA сброшена, сессии пользователя завершены' : 'Готово');
    },
    onError: notifyError,
  });

  const confirm = (title: string, text: string, run: () => void, danger = false) =>
    modals.openConfirmModal({
      title,
      children: <Text size="sm">{text}</Text>,
      labels: { confirm: 'Подтвердить', cancel: 'Отмена' },
      confirmProps: { color: danger ? 'red' : 'brand' },
      onConfirm: run,
    });

  return (
    <Stack>
      <PageHeader
        title="Пользователи"
        description="Доступ выдаётся только по приглашению"
        actions={
          <Button leftSection={<IconUserPlus size={16} />} onClick={() => setInviting(true)}>
            Пригласить
          </Button>
        }
      />
      <Group grow preventGrowOverflow={false} wrap="wrap">
        <TextInput
          placeholder="ФИО, email, организация"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          miw={220}
        />
        <Select placeholder="Роль" clearable data={roleOptions} value={role} onChange={(v) => (setRole(v), setPage(1))} miw={180} />
        <Select
          placeholder="Статус"
          clearable
          data={Object.entries(USER_STATUS).map(([value, s]) => ({ value, label: s.label }))}
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          miw={160}
        />
      </Group>
      <Modal opened={!!resentLink} onClose={() => setResentLink(null)} title="Ссылка-приглашение" size="lg">
        {resentLink && <InviteLink result={resentLink} />}
      </Modal>
      <QueryState isLoading={list.isLoading} error={list.error}>
        <Table.ScrollContainer minWidth={860}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пользователь</Table.Th>
                <Table.Th>Организация</Table.Th>
                <Table.Th>Роль и права</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Последний вход</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data?.items.map((u) => {
                const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
                return (
                  <Table.Tr key={u.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {u.fullName}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {u.email}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{u.organization ? u.organization.shortName || u.organization.name : '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Badge variant={u.systemRole === 'USER' ? 'outline' : 'filled'} color={u.systemRole === 'ADMIN' ? 'red' : u.systemRole === 'SECRETARY' ? 'indigo' : 'gray'} size="sm">
                          {SYSTEM_ROLE[u.systemRole]}
                        </Badge>
                        {u.canViewAll && (
                          <Badge color="grape" variant="light" size="sm">
                            видит всё
                          </Badge>
                        )}
                        {u.totpEnabledAt && (
                          <Tooltip label="2FA включена">
                            <IconShieldCheck size={16} color="var(--mantine-color-teal-6)" />
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Badge color={USER_STATUS[u.status].color} variant="light" size="sm">
                          {USER_STATUS[u.status].label}
                        </Badge>
                        {u.status === 'INVITED' && (manage || u.systemRole === 'USER') && (
                          <Button size="compact-xs" variant="light" leftSection={<IconCopy size={12} />} onClick={() => action.mutate({ path: `/admin/users/${u.id}/invite-link` })}>
                            Ссылка
                          </Button>
                        )}
                        {locked && (
                          <Badge color="orange" variant="light" size="sm" leftSection={<IconLock size={10} />}>
                            вход заблокирован
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{fmtDateTime(u.lastLoginAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {(manage || (u.status === 'INVITED' && u.systemRole === 'USER')) && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" aria-label="Действия">
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {manage && <Menu.Item onClick={() => setEditing(u)}>Изменить</Menu.Item>}
                          {u.status === 'INVITED' && (
                            <Menu.Item leftSection={<IconMailForward size={14} />} onClick={() => action.mutate({ path: `/admin/users/${u.id}/resend-invite` })}>
                              Заменить ссылку (прежняя перестанет работать)
                            </Menu.Item>
                          )}
                          {manage && locked && <Menu.Item onClick={() => action.mutate({ path: `/admin/users/${u.id}/unlock` })}>Снять блокировку входа</Menu.Item>}
                          {manage && u.totpEnabledAt && u.id !== me.id && (
                            <Menu.Item
                              leftSection={<IconShieldOff size={14} />}
                              onClick={() =>
                                confirm('Сбросить 2FA?', `${u.fullName} при следующем входе настроит 2FA заново. Все его сессии будут завершены.`, () =>
                                  action.mutate({ path: `/admin/users/${u.id}/reset-2fa` }),
                                )
                              }
                            >
                              Сбросить 2FA
                            </Menu.Item>
                          )}
                          {manage && u.id !== me.id && u.status === 'ACTIVE' && (
                            <Menu.Item
                              color="red"
                              onClick={() =>
                                confirm('Заблокировать пользователя?', `${u.fullName} сразу потеряет доступ к порталу.`, () =>
                                  action.mutate({ path: `/admin/users/${u.id}`, body: { status: 'BLOCKED' } }), true)
                              }
                            >
                              Заблокировать
                            </Menu.Item>
                          )}
                          {manage && u.status === 'BLOCKED' && (
                            <Menu.Item onClick={() => action.mutate({ path: `/admin/users/${u.id}`, body: { status: 'ACTIVE' } })}>Разблокировать</Menu.Item>
                          )}
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
        {list.data && list.data.total > PAGE_SIZE && (
          <Group justify="center">
            <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </QueryState>
      <InviteModal opened={inviting} onClose={() => setInviting(false)} />
      <Drawer opened={!!editing} onClose={() => setEditing(null)} title="Пользователь" position="right" size="md">
        {editing && <EditDrawer key={editing.id} user={editing} onClose={() => setEditing(null)} />}
      </Drawer>
    </Stack>
  );
}

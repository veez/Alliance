import { Button, Card, Group, Pagination, SegmentedControl, Stack, Switch, Table, Tabs, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { NotificationPage, NotificationPreference } from '../api/types';
import { notifyError, notifyOk, PageHeader, QueryState } from '../components/common';
import { NotificationRow, useOpenNotification } from '../components/NotificationBell';

const PAGE = 20;

function Feed() {
  const qc = useQueryClient();
  const open = useOpenNotification();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['notifications', 'feed', filter, page],
    queryFn: () => api<NotificationPage>(`/notifications?pageSize=${PAGE}&page=${page}${filter === 'unread' ? '&unread=true' : ''}`),
  });
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <Stack>
      <Group justify="space-between">
        <SegmentedControl
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          data={[
            { value: 'all', label: 'Все' },
            { value: 'unread', label: `Непрочитанные${q.data?.unread ? ` (${q.data.unread})` : ''}` },
          ]}
        />
        <Button variant="subtle" disabled={!q.data?.unread} onClick={readAll}>
          Отметить все прочитанными
        </Button>
      </Group>
      <QueryState isLoading={q.isLoading} error={q.error}>
        <Card withBorder padding="xs">
          <Stack gap={2}>
            {q.data?.items.length ? q.data.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={open} />) : <Text c="dimmed" p="sm">Уведомлений нет.</Text>}
          </Stack>
        </Card>
        {(q.data?.total ?? 0) > PAGE && <Pagination total={Math.ceil(q.data!.total / PAGE)} value={page} onChange={setPage} />}
      </QueryState>
    </Stack>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<NotificationPreference[]>('/notifications/preferences') });
  const [rows, setRows] = useState<NotificationPreference[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setRows(q.data);
  }, [q.data]);
  const set = (type: string, key: 'inApp' | 'email', v: boolean) => setRows((rs) => rs.map((r) => (r.type === type ? { ...r, [key]: v } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(q.data ?? []);
  const save = async () => {
    setBusy(true);
    try {
      const res = await api<NotificationPreference[]>('/notifications/preferences', { method: 'PUT', body: { items: rows.map(({ type, inApp, email }) => ({ type, inApp, email })) } });
      qc.setQueryData(['notification-prefs'], res);
      notifyOk('Настройки уведомлений сохранены');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      <Stack>
        <Text size="sm" c="dimmed">
          Письма о входе, приглашениях и сбросе пароля приходят всегда.
        </Text>
        <Card withBorder padding={0}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Событие</Table.Th>
                <Table.Th w={110}>В портале</Table.Th>
                <Table.Th w={110}>По почте</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((g) => [
                <Table.Tr key={g}>
                  <Table.Td colSpan={3} bg="var(--mantine-color-gray-0)">
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                      {g}
                    </Text>
                  </Table.Td>
                </Table.Tr>,
                ...rows
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <Table.Tr key={r.type}>
                      <Table.Td>
                        <Text size="sm">{r.label}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Switch checked={r.inApp} onChange={(e) => set(r.type, 'inApp', e.currentTarget.checked)} aria-label={`${r.label}: в портале`} />
                      </Table.Td>
                      <Table.Td>
                        {r.emailAvailable ? (
                          <Switch checked={r.email} onChange={(e) => set(r.type, 'email', e.currentTarget.checked)} aria-label={`${r.label}: по почте`} />
                        ) : (
                          <Text size="xs" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )),
              ])}
            </Table.Tbody>
          </Table>
        </Card>
        <Group justify="flex-end">
          <Button disabled={!dirty} loading={busy} onClick={save}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </QueryState>
  );
}

export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'feed';
  return (
    <>
      <PageHeader title="Уведомления" />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'feed' })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="feed">Лента</Tabs.Tab>
          <Tabs.Tab value="settings">Настройки</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="feed">
          <Feed />
        </Tabs.Panel>
        <Tabs.Panel value="settings">
          <Preferences />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

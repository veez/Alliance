import { ActionIcon, Anchor, Divider, Group, Indicator, Popover, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { NotificationItem, NotificationPage } from '../api/types';
import { fmtDateTime } from '../labels';

export function useOpenNotification() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async (n: NotificationItem) => {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.link) navigate(n.link);
  };
}

export function NotificationRow({ n, onOpen }: { n: NotificationItem; onOpen: (n: NotificationItem) => void }) {
  return (
    <UnstyledButton onClick={() => onOpen(n)} p="xs" style={{ borderRadius: 6, background: n.readAt ? undefined : 'var(--mantine-color-teal-0)' }} w="100%">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <div style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, flexShrink: 0, background: n.readAt ? 'transparent' : 'var(--mantine-color-teal-6)' }} />
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={n.readAt ? 400 : 600} lineClamp={2}>
            {n.title}
          </Text>
          {n.body && (
            <Text size="xs" c="dimmed" lineClamp={2}>
              {n.body}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {fmtDateTime(n.createdAt)}
          </Text>
        </div>
      </Group>
    </UnstyledButton>
  );
}

export function NotificationBell() {
  const qc = useQueryClient();
  const [opened, setOpened] = useState(false);
  const open = useOpenNotification();
  const count = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const list = useQuery({ queryKey: ['notifications', 'recent'], queryFn: () => api<NotificationPage>('/notifications?pageSize=8'), enabled: opened });
  const unread = count.data?.count ?? 0;
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={360} shadow="md">
      <Popover.Target>
        <Indicator label={unread > 99 ? '99+' : unread} size={16} disabled={!unread} color="red" offset={4}>
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setOpened((o) => !o)} aria-label={`Уведомления${unread ? `: ${unread} непрочитанных` : ''}`}>
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Group justify="space-between" px="xs" mb={4}>
          <Text fw={600} size="sm">
            Уведомления
          </Text>
          {unread > 0 && (
            <Anchor size="xs" onClick={readAll}>
              Прочитать все
            </Anchor>
          )}
        </Group>
        <ScrollArea.Autosize mah={400}>
          <Stack gap={2}>
            {list.data?.items.length ? (
              list.data.items.map((n) => (
                <NotificationRow
                  key={n.id}
                  n={n}
                  onOpen={(x) => {
                    setOpened(false);
                    void open(x);
                  }}
                />
              ))
            ) : (
              <Text size="sm" c="dimmed" p="xs">
                {list.isLoading ? 'Загрузка…' : 'Уведомлений пока нет.'}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>
        <Divider my={6} />
        <Anchor component={Link} to="/notifications" size="sm" px="xs" onClick={() => setOpened(false)}>
          Все уведомления и настройки
        </Anchor>
      </Popover.Dropdown>
    </Popover>
  );
}

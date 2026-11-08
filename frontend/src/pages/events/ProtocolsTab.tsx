import { Anchor, Button, Group, Pagination, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconFilePlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { Page, ProtocolListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { QueryState, DemoBadge } from '../../components/common';
import { fmtDate } from '../../labels';
import { EventTypeBadge, ProtocolStatusBadge } from './EventShared';

export function ProtocolsTab({ workingGroupId }: { workingGroupId?: string }) {
  const { can } = useAuth();
  const now = new Date().getFullYear();
  const [year, setYear] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['protocols', workingGroupId, year, status, debounced, page],
    queryFn: () => api<Page<ProtocolListItem>>(`/protocols${qs({ workingGroupId, year, status, search: debounced || undefined, page, pageSize: 20 })}`),
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="sm">
          <Select placeholder="Все годы" clearable w={130} value={year} onChange={reset(setYear)} data={[now + 1, now, now - 1, now - 2].map(String)} />
          {can('protocols.manage') && (
            <Select
              placeholder="Все статусы"
              clearable
              w={170}
              value={status}
              onChange={reset(setStatus)}
              data={[
                { value: 'PUBLISHED', label: 'Опубликованные' },
                { value: 'DRAFT', label: 'Черновики' },
              ]}
            />
          )}
          <TextInput placeholder="Поиск по названию и номеру" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => reset(setSearch)(e.currentTarget.value)} />
        </Group>
        {can('protocols.manage') && !workingGroupId && (
          <Button variant="light" leftSection={<IconFilePlus size={18} />} component={Link} to="/protocols/new">
            Новый протокол
          </Button>
        )}
      </Group>
      <QueryState isLoading={q.isLoading} error={q.error}>
        {q.data?.items.length ? (
          <Table.ScrollContainer minWidth={700}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={110}>Дата</Table.Th>
                  <Table.Th>Протокол</Table.Th>
                  <Table.Th>Мероприятие</Table.Th>
                  <Table.Th w={130}>Статус</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {q.data.items.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{fmtDate(p.heldAt)}</Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/protocols/${p.id}`} size="sm" fw={500}>
                        {p.number ? `№ ${p.number}. ` : ''}
                        {p.title} <DemoBadge show={p.isDemo} />
                      </Anchor>
                      <Text size="xs" c="dimmed">
                        Вопросов: {p._count.items}
                        {p.workingGroup ? ` · ${p.workingGroup.name}` : ''}
                        {p.author ? ` · ${p.author.fullName}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {p.event ? (
                        <Group gap={6}>
                          <EventTypeBadge type={p.event.type} />
                          <Anchor component={Link} to={`/events/${p.event.id}`} size="sm">
                            {p.event.title}
                          </Anchor>
                        </Group>
                      ) : (
                        <Text size="sm" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <ProtocolStatusBadge status={p.status} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text c="dimmed">Протоколов пока нет.</Text>
        )}
        {(q.data?.total ?? 0) > 20 && <Pagination total={Math.ceil(q.data!.total / 20)} value={page} onChange={setPage} />}
      </QueryState>
    </Stack>
  );
}

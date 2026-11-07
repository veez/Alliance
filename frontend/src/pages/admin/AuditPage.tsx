import { Code, Group, Modal, Pagination, ScrollArea, Select, SimpleGrid, Stack, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, qs } from '../../api/client';
import type { AuditEntry, Page } from '../../api/types';
import { PageHeader, QueryState } from '../../components/common';
import { AUDIT_ACTION, ENTITY_TYPE, fmtDateTime } from '../../labels';

const PAGE_SIZE = 50;

/** Поля, изменившиеся между before и after. */
function diffKeys(before: unknown, after: unknown): string[] {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a).filter((k) => !['updatedAt', 'createdAt'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const [debouncedAction] = useDebouncedValue(action, 300);
  const [entityType, setEntityType] = useState<string | null>(null);
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const list = useQuery({
    queryKey: ['audit', debouncedAction, entityType, range, page],
    queryFn: () =>
      api<Page<AuditEntry>>(
        `/admin/audit${qs({
          action: debouncedAction,
          entityType,
          from: range[0] ? dayjs(range[0]).startOf('day').toISOString() : undefined,
          to: range[1] ? dayjs(range[1]).endOf('day').toISOString() : undefined,
          page,
          pageSize: PAGE_SIZE,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <Stack>
      <PageHeader title="Журнал аудита" description="Кто, что и когда изменил. Записи журнала нельзя изменить или удалить." />
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput placeholder="Действие (например, organization)" value={action} onChange={(e) => (setAction(e.currentTarget.value), setPage(1))} />
        <Select
          placeholder="Тип объекта"
          clearable
          value={entityType}
          onChange={(v) => (setEntityType(v), setPage(1))}
          data={Object.entries(ENTITY_TYPE).map(([value, label]) => ({ value, label }))}
        />
        <DatePickerInput type="range" placeholder="Период" clearable value={range} onChange={(v) => (setRange(v), setPage(1))} valueFormat="DD.MM.YYYY" />
      </SimpleGrid>
      <QueryState isLoading={list.isLoading} error={list.error}>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Время (МСК)</Table.Th>
                <Table.Th>Кто</Table.Th>
                <Table.Th>Действие</Table.Th>
                <Table.Th>Объект</Table.Th>
                <Table.Th>Изменённые поля</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data?.items.map((e) => (
                <Table.Tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(e)}>
                  <Table.Td>
                    <Text size="xs">{fmtDateTime(e.createdAt)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{e.actor?.fullName ?? 'система'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <UnstyledButton>
                      <Text size="sm">{AUDIT_ACTION[e.action] ?? e.action}</Text>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {ENTITY_TYPE[e.entityType] ?? e.entityType}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {diffKeys(e.before, e.after).join(', ')}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {list.data && list.data.total > PAGE_SIZE && (
          <Group justify="center">
            <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </QueryState>
      <Modal opened={!!selected} onClose={() => setSelected(null)} title={selected ? (AUDIT_ACTION[selected.action] ?? selected.action) : ''} size="xl">
        {selected && (
          <Stack gap="xs">
            <Text size="sm">
              {fmtDateTime(selected.createdAt)} · {selected.actor ? `${selected.actor.fullName} (${selected.actor.email})` : 'система'} · IP {selected.ip ?? '—'}
            </Text>
            <Text size="xs" c="dimmed">
              {selected.entityType} {selected.entityId}
            </Text>
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <div>
                <Text size="sm" fw={500}>
                  До
                </Text>
                <ScrollArea h={360}>
                  <Code block>{selected.before ? JSON.stringify(selected.before, null, 2) : '—'}</Code>
                </ScrollArea>
              </div>
              <div>
                <Text size="sm" fw={500}>
                  После
                </Text>
                <ScrollArea h={360}>
                  <Code block>{selected.after ? JSON.stringify(selected.after, null, 2) : '—'}</Code>
                </ScrollArea>
              </div>
            </SimpleGrid>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

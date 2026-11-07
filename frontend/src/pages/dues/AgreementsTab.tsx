import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Pagination, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPencil, IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { api, qs } from '../../api/client';
import type { Agreement, AgreementStatus, Organization, Page } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, QueryState } from '../../components/common';
import { AGREEMENT_STATUS, fmtDay, fmtRub } from '../../labels';
import { DocList } from './DuesShared';

const PAGE_SIZE = 50;

function AgreementModal({ agreement, onClose }: { agreement: Agreement | null; onClose: () => void }) {
  const qc = useQueryClient();
  const orgs = useQuery({ queryKey: ['organizations', 'members-brief'], queryFn: () => api<Page<Organization>>('/organizations?status=MEMBER&pageSize=200') });
  const form = useForm({
    initialValues: {
      organizationId: agreement?.organizationId ?? (null as string | null),
      number: agreement?.number ?? '',
      year: agreement?.year ?? new Date().getFullYear(),
      signedAt: agreement?.signedAt ? new Date(agreement.signedAt) : (null as Date | null),
      amount: agreement?.amount ?? ('' as number | string),
      status: agreement?.status ?? ('DRAFT' as AgreementStatus),
    },
    validate: {
      organizationId: (v) => (v ? null : 'Выберите организацию'),
      number: (v) => (v.trim() ? null : 'Укажите номер'),
    },
  });
  const save = useMutation({
    mutationFn: (v: typeof form.values) => {
      const body = { ...v, signedAt: v.signedAt ? dayjs(v.signedAt).format('YYYY-MM-DD') : null, amount: v.amount === '' ? null : Number(v.amount) };
      return agreement ? api(`/agreements/${agreement.id}`, { method: 'PATCH', body }) : api('/agreements', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agreements'] });
      notifyOk('Договор сохранён');
      onClose();
    },
    onError: notifyError,
  });
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <Select
          label="Организация"
          searchable
          disabled={!!agreement}
          data={(orgs.data?.items ?? []).map((o) => ({ value: o.id, label: o.shortName || o.name }))}
          {...form.getInputProps('organizationId')}
        />
        <SimpleGrid cols={2}>
          <TextInput label="Номер договора" placeholder="ДП-2026/05" {...form.getInputProps('number')} />
          <NumberInput label="Год" min={2000} max={2100} {...form.getInputProps('year')} />
          <DateInput label="Дата подписания" valueFormat="DD.MM.YYYY" clearable {...form.getInputProps('signedAt')} />
          <NumberInput label="Сумма, ₽" min={0} thousandSeparator=" " decimalScale={2} {...form.getInputProps('amount')} />
        </SimpleGrid>
        <Select
          label="Статус"
          allowDeselect={false}
          data={Object.entries(AGREEMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))}
          {...form.getInputProps('status')}
        />
        <Text size="xs" c="dimmed">
          Скан договора прикладывается в списке после сохранения.
        </Text>
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

export function AgreementsTab() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('dues.manage');
  const [year, setYear] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Agreement | null | undefined>(undefined);
  const list = useQuery({
    queryKey: ['agreements', year, status, debounced, page],
    queryFn: () => api<Page<Agreement>>(`/agreements${qs({ year, status, search: debounced, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const thisYear = new Date().getFullYear();

  return (
    <Stack>
      <Group justify="space-between">
        <SimpleGrid cols={{ base: 1, sm: 3 }} style={{ flex: 1 }}>
          <TextInput placeholder="Номер или организация" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} />
          <Select placeholder="Год" clearable value={year} onChange={(v) => (setYear(v), setPage(1))} data={[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(String)} />
          <Select
            placeholder="Статус"
            clearable
            value={status}
            onChange={(v) => (setStatus(v), setPage(1))}
            data={Object.entries(AGREEMENT_STATUS).map(([value, s]) => ({ value, label: s.label }))}
          />
        </SimpleGrid>
        {manage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
            Новый договор
          </Button>
        )}
      </Group>
      <QueryState isLoading={list.isLoading} error={list.error}>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Договор</Table.Th>
                <Table.Th>Организация</Table.Th>
                <Table.Th ta="right">Сумма</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Файлы</Table.Th>
                {manage && <Table.Th w={40} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data?.items.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      № {a.number}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {a.year} г. · {a.signedAt ? `подписан ${fmtDay(a.signedAt)}` : 'не подписан'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{a.organization?.shortName || a.organization?.name}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{fmtRub(a.amount)}</Table.Td>
                  <Table.Td>
                    <Badge color={AGREEMENT_STATUS[a.status].color} variant="light">
                      {AGREEMENT_STATUS[a.status].label}
                    </Badge>
                  </Table.Td>
                  <Table.Td miw={220}>
                    <DocList docs={a.documents} basePath={`/agreements/${a.id}`} canUpload={manage} canRemove={manage} onChanged={() => qc.invalidateQueries({ queryKey: ['agreements'] })} />
                  </Table.Td>
                  {manage && (
                    <Table.Td>
                      <ActionIcon variant="subtle" onClick={() => setEditing(a)} aria-label="Изменить договор">
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {list.data && !list.data.items.length && <Text c="dimmed">Договоров нет.</Text>}
        {list.data && list.data.total > PAGE_SIZE && (
          <Group justify="center">
            <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </QueryState>
      <Modal opened={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? `Договор № ${editing.number}` : 'Новый договор пожертвования'}>
        {editing !== undefined && <AgreementModal agreement={editing} onClose={() => setEditing(undefined)} />}
      </Modal>
    </Stack>
  );
}

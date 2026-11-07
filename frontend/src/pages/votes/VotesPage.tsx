import { Anchor, Badge, Button, Card, Group, Pagination, Progress, Select, SimpleGrid, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCheck, IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { Page, VoteListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader, QueryState } from '../../components/common';
import { fmtDateTime, timeLeft, VOTE_SCENARIO, VOTE_STATUS } from '../../labels';

const PAGE_SIZE = 20;

export function VoteStatusBadge({ status }: { status: VoteListItem['status'] }) {
  return (
    <Badge color={VOTE_STATUS[status].color} variant="light">
      {VOTE_STATUS[status].label}
    </Badge>
  );
}

export function VoteCard({ v }: { v: VoteListItem }) {
  const turnout = v.eligibleCount ? Math.round((v.participatedCount / v.eligibleCount) * 100) : 0;
  return (
    <Card withBorder padding="md">
      <Stack gap={8}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Text size="xs" c="dimmed">
              № {v.number} · {VOTE_SCENARIO[v.scenario]}
            </Text>
            <Anchor component={Link} to={`/votes/${v.id}`} fw={600}>
              {v.title}
            </Anchor>
          </div>
          <VoteStatusBadge status={v.status} />
        </Group>
        {v.status === 'ACTIVE' && (
          <>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                до {fmtDateTime(v.endsAt)} · {timeLeft(v.endsAt)}
              </Text>
              <Text size="xs" c="dimmed">
                проголосовали {v.participatedCount} из {v.eligibleCount}
              </Text>
            </Group>
            <Progress value={turnout} color={turnout >= v.quorumPercent ? 'teal' : 'blue'} size="sm" />
          </>
        )}
        {v.status === 'CLOSED' && (
          <Text size="xs" c="dimmed">
            Завершено {fmtDateTime(v.closedAt)} · проголосовали {v.participatedCount} из {v.eligibleCount} ·{' '}
            {v.quorumReached ? 'кворум набран' : 'кворума нет'}
          </Text>
        )}
        <Group justify="space-between">
          {v.myVotedAt ? (
            <Badge color="teal" variant="outline" leftSection={<IconCheck size={12} />}>
              Ваша организация проголосовала
            </Badge>
          ) : (
            <span />
          )}
          {v.canVote && !v.myVotedAt && (
            <Button component={Link} to={`/votes/${v.id}`} size="xs">
              Проголосовать
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

export function VotesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'active';
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [scenario, setScenario] = useState<string | null>(null);
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);
  const [page, setPage] = useState(1);
  const manage = can('votes.create');

  const list = useQuery({
    queryKey: ['votes', tab, debounced, scenario, range, page],
    queryFn: () =>
      api<Page<VoteListItem>>(
        `/votes${qs({
          tab,
          search: debounced,
          scenario,
          from: range[0] ? dayjs(range[0]).startOf('day').toISOString() : undefined,
          to: range[1] ? dayjs(range[1]).endOf('day').toISOString() : undefined,
          page,
          pageSize: PAGE_SIZE,
        })}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: tab === 'active' ? 30_000 : false,
  });

  return (
    <Stack>
      <PageHeader
        title="Голосования"
        description="Открытые поимённые голосования. Одна организация — один голос."
        actions={
          manage && (
            <Button component={Link} to="/votes/new" leftSection={<IconPlus size={16} />}>
              Новое голосование
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => {
          setParams({ tab: v ?? 'active' });
          setPage(1);
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="active">Идут</Tabs.Tab>
          <Tabs.Tab value="archive">Архив</Tabs.Tab>
          {manage && <Tabs.Tab value="drafts">Черновики</Tabs.Tab>}
        </Tabs.List>
      </Tabs>
      {tab !== 'active' && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput placeholder="Название или номер" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} />
          <Select
            placeholder="Вид голосования"
            clearable
            value={scenario}
            onChange={(v) => (setScenario(v), setPage(1))}
            data={Object.entries(VOTE_SCENARIO).map(([value, label]) => ({ value, label }))}
          />
          <DatePickerInput type="range" placeholder="Период окончания" clearable value={range} onChange={(v) => (setRange(v), setPage(1))} valueFormat="DD.MM.YYYY" />
        </SimpleGrid>
      )}
      <QueryState isLoading={list.isLoading} error={list.error}>
        {list.data?.items.length ? (
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            {list.data.items.map((v) => (
              <VoteCard key={v.id} v={v} />
            ))}
          </SimpleGrid>
        ) : (
          <Text c="dimmed">{tab === 'active' ? 'Сейчас нет идущих голосований.' : 'Ничего не найдено.'}</Text>
        )}
        {list.data && list.data.total > PAGE_SIZE && (
          <Group justify="center">
            <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </QueryState>
    </Stack>
  );
}

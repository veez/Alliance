import { Anchor, Badge, Button, Card, Grid, Group, Indicator, Pagination, SegmentedControl, Select, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { Calendar } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCalendarPlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { EventListItem, EventType, Page } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader, QueryState } from '../../components/common';
import { EVENT_FORMAT, EVENT_TYPE, fmtDate, fmtTime, TZ } from '../../labels';
import { EventFormModal, EventStatusBadge, EventTypeBadge, ProtocolStatusBadge, RegistrationBadge } from './EventShared';
import { ProtocolsTab } from './ProtocolsTab';
import { StatsTab } from './StatsTab';

const mskDay = (v: string | Date) => dayjs(v).tz(TZ).format('YYYY-MM-DD');

export function EventRow({ e }: { e: EventListItem }) {
  const past = new Date(e.endsAt ?? e.startsAt) < new Date();
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Group wrap="nowrap" align="flex-start" gap="md" style={{ minWidth: 0 }}>
          <Stack gap={0} align="center" w={56} style={{ flexShrink: 0 }}>
            <Text fw={700} size="xl" lh={1.1}>
              {dayjs(e.startsAt).tz(TZ).format('D')}
            </Text>
            <Text size="xs" c="dimmed">
              {dayjs(e.startsAt).tz(TZ).format('MMM YYYY')}
            </Text>
          </Stack>
          <div style={{ minWidth: 0 }}>
            <Anchor component={Link} to={`/events/${e.id}`} fw={500} td={e.status === 'CANCELLED' ? 'line-through' : undefined}>
              {e.title}
            </Anchor>
            <Text size="sm" c="dimmed">
              {fmtTime(e.startsAt)}
              {e.endsAt ? `–${fmtTime(e.endsAt)}` : ''} МСК · {EVENT_FORMAT[e.format]}
              {e.location ? ` · ${e.location}` : ''}
            </Text>
            <Group gap={6} mt={4}>
              <EventTypeBadge type={e.type} />
              <EventStatusBadge status={e.status} />
              {e.workingGroup && (
                <Badge variant="outline" color="grape" size="sm">
                  {e.workingGroup.name}
                </Badge>
              )}
              {e.protocols.map((p) => (
                <Anchor key={p.id} component={Link} to={`/protocols/${p.id}`} size="xs">
                  <Group gap={4}>
                    Протокол {p.number ?? ''} {p.status === 'DRAFT' && <ProtocolStatusBadge status={p.status} />}
                  </Group>
                </Anchor>
              ))}
            </Group>
          </div>
        </Group>
        <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
          {e.my && e.my.registration !== 'INVITED' && <RegistrationBadge value={e.my.registration} />}
          {!past && e.canRegister && (!e.my || e.my.registration === 'INVITED') && (
            <Button component={Link} to={`/events/${e.id}`} size="compact-xs">
              Ответить
            </Button>
          )}
          <Text size="xs" c="dimmed">
            очно {e.registrations.offline} · онлайн {e.registrations.online}
          </Text>
        </Stack>
      </Group>
    </Card>
  );
}

function CalendarTab() {
  const { can } = useAuth();
  const [month, setMonth] = useState(() => dayjs().tz(TZ).startOf('month').toDate());
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [type, setType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);

  const from = dayjs(month).startOf('month').subtract(7, 'day');
  const to = dayjs(month).endOf('month').add(7, 'day');
  const monthQ = useQuery({
    queryKey: ['events', 'month', from.toISOString()],
    queryFn: () => api<Page<EventListItem>>(`/events${qs({ scope: 'all', from: from.toISOString(), to: to.toISOString(), pageSize: 200 })}`),
  });
  const listQ = useQuery({
    queryKey: ['events', 'list', scope, type, debounced, page],
    queryFn: () => api<Page<EventListItem>>(`/events${qs({ scope, type, search: debounced || undefined, page, pageSize: 10 })}`),
  });
  const byDay = new Map<string, EventListItem[]>();
  for (const e of monthQ.data?.items ?? []) {
    const k = mskDay(e.startsAt);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const monthItems = (monthQ.data?.items ?? []).filter((e) =>
    selected ? mskDay(e.startsAt) === selected : dayjs(e.startsAt).tz(TZ).format('YYYY-MM') === dayjs(month).format('YYYY-MM'),
  );

  return (
    <Stack>
      <Grid>
        <Grid.Col span={{ base: 12, md: 'content' }}>
          <Card withBorder padding="md">
            <Calendar
              date={month}
              onDateChange={(d) => {
                setMonth(d);
                setSelected(null);
              }}
              getDayProps={(d) => {
                const k = dayjs(d).format('YYYY-MM-DD');
                return { selected: k === selected, onClick: () => setSelected(k === selected ? null : k) };
              }}
              renderDay={(d) => {
                const list = byDay.get(dayjs(d).format('YYYY-MM-DD'));
                const color = list ? EVENT_TYPE[list[0].type].color : undefined;
                return (
                  <Indicator size={7} color={color} offset={-3} disabled={!list}>
                    <div>{d.getDate()}</div>
                  </Indicator>
                );
              }}
            />
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 'auto' }}>
          <Group justify="space-between" mb="xs">
            <Text fw={600}>{selected ? `Мероприятия ${fmtDate(selected)}` : `Мероприятия: ${dayjs(month).format('MMMM YYYY')}`}</Text>
            {selected && (
              <Anchor size="sm" onClick={() => setSelected(null)}>
                весь месяц
              </Anchor>
            )}
          </Group>
          <QueryState isLoading={monthQ.isLoading} error={monthQ.error}>
            <Stack gap="xs">
              {monthItems.length ? monthItems.map((e) => <EventRow key={e.id} e={e} />) : <Text c="dimmed" size="sm">Мероприятий нет.</Text>}
            </Stack>
          </QueryState>
        </Grid.Col>
      </Grid>

      <Group justify="space-between" mt="md">
        <SegmentedControl
          value={scope}
          onChange={(v) => {
            setScope(v as 'upcoming' | 'past');
            setPage(1);
          }}
          data={[
            { value: 'upcoming', label: 'Предстоящие' },
            { value: 'past', label: 'Прошедшие' },
          ]}
        />
        <Group gap="sm">
          <Select
            placeholder="Все типы"
            clearable
            w={200}
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            data={(Object.keys(EVENT_TYPE) as EventType[]).map((k) => ({ value: k, label: EVENT_TYPE[k].label }))}
          />
          <TextInput
            placeholder="Поиск"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setPage(1);
            }}
          />
        </Group>
      </Group>
      <QueryState isLoading={listQ.isLoading} error={listQ.error}>
        <Stack gap="xs">
          {listQ.data?.items.length ? listQ.data.items.map((e) => <EventRow key={e.id} e={e} />) : <Text c="dimmed">Ничего не найдено.</Text>}
          {(listQ.data?.total ?? 0) > 10 && <Pagination total={Math.ceil(listQ.data!.total / 10)} value={page} onChange={setPage} />}
        </Stack>
      </QueryState>
      {!can('events.participate') && !can('orgs.read_all') && (
        <Text size="sm" c="dimmed">
          Показаны мероприятия, открытые для партнёров Альянса.
        </Text>
      )}
    </Stack>
  );
}

export function EventsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'calendar';
  const [creating, setCreating] = useState(false);
  const showStats = can('events.participate') || can('orgs.read_all');
  const showProtocols = can('protocols.read') || can('protocols.manage') || can('partner_materials.read');
  return (
    <>
      <PageHeader
        title="Мероприятия"
        description="Общие собрания, конференции и заседания рабочих групп. Время — московское."
        actions={
          can('events.manage') && (
            <Button leftSection={<IconCalendarPlus size={18} />} onClick={() => setCreating(true)}>
              Новое мероприятие
            </Button>
          )
        }
      />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'calendar' })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="calendar">Календарь</Tabs.Tab>
          {showProtocols && <Tabs.Tab value="protocols">Протоколы</Tabs.Tab>}
          {showStats && <Tabs.Tab value="stats">Посещаемость и активность</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="calendar">
          <CalendarTab />
        </Tabs.Panel>
        <Tabs.Panel value="protocols">
          <ProtocolsTab />
        </Tabs.Panel>
        <Tabs.Panel value="stats">
          <StatsTab />
        </Tabs.Panel>
      </Tabs>
      {creating && <EventFormModal opened onClose={() => setCreating(false)} />}
    </>
  );
}

import { Alert, Anchor, Badge, Button, Card, Group, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBuilding, IconChartBar, IconCalendarEvent, IconCoin, IconInfoCircle, IconListCheck, IconUsersGroup, type Icon as TablerIcon } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { EventStats, WgActivity, EventListItem, DuesRow, DuesSummary, Organization, Page, VoteListItem } from '../api/types';
import { useAuth, useMe } from '../auth/AuthContext';
import { StatusBadge } from '../components/common';
import { DUES_STATUS, EVENT_FORMAT, fmtDateTime, REGISTRATION, fmtDay, fmtRub, SYSTEM_ROLE, timeLeft } from '../labels';

function Tile({ icon: Icon, title, children, to, color = 'brand' }: { icon: TablerIcon; title: string; children: ReactNode; to?: string; color?: string }) {
  const body = (
    <>
      <Group gap="sm" mb="sm" wrap="nowrap">
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          <Icon size={20} />
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
      </Group>
      {children}
    </>
  );
  return to ? (
    <Card withBorder padding="lg" component={Link} to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </Card>
  ) : (
    <Card withBorder padding="lg">
      {body}
    </Card>
  );
}

function ActiveVotesTile() {
  const votes = useQuery({
    queryKey: ['votes', 'dashboard-active'],
    queryFn: () => api<Page<VoteListItem>>('/votes?tab=active&pageSize=5'),
    refetchInterval: 60_000,
  });
  const items = votes.data?.items ?? [];
  const pending = items.filter((v) => v.canVote && !v.myVotedAt).length;
  return (
    <Tile icon={IconListCheck} title="Активные голосования">
      {votes.isLoading ? (
        <Text size="sm" c="dimmed">
          Загрузка…
        </Text>
      ) : items.length ? (
        <Stack gap={8}>
          {pending > 0 && (
            <Badge color="orange" variant="light">
              Ждут голоса вашей организации: {pending}
            </Badge>
          )}
          {items.map((v) => (
            <Group key={v.id} justify="space-between" wrap="nowrap" gap="xs">
              <div style={{ minWidth: 0 }}>
                <Anchor component={Link} to={`/votes/${v.id}`} size="sm" lineClamp={1}>
                  {v.title}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {timeLeft(v.endsAt)} · {v.participatedCount}/{v.eligibleCount}
                </Text>
              </div>
              {v.canVote && !v.myVotedAt ? (
                <Button component={Link} to={`/votes/${v.id}`} size="compact-xs" style={{ flexShrink: 0 }}>
                  Проголосовать
                </Button>
              ) : v.myVotedAt ? (
                <Badge size="xs" color="teal" variant="light" style={{ flexShrink: 0 }}>
                  голос учтён
                </Badge>
              ) : null}
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          Сейчас нет идущих голосований.
        </Text>
      )}
    </Tile>
  );
}

function UpcomingEventsTile() {
  const q = useQuery({ queryKey: ['events', 'dashboard'], queryFn: () => api<Page<EventListItem>>('/events?scope=upcoming&pageSize=4') });
  const items = q.data?.items ?? [];
  return (
    <Tile icon={IconCalendarEvent} title="Ближайшие события" color="indigo" to="/events">
      {q.isLoading ? (
        <Text size="sm" c="dimmed">Загрузка…</Text>
      ) : items.length ? (
        <Stack gap={8}>
          {items.map((e) => (
            <Group key={e.id} justify="space-between" wrap="nowrap" gap="xs">
              <div style={{ minWidth: 0 }}>
                <Anchor component={Link} to={`/events/${e.id}`} size="sm" lineClamp={1}>
                  {e.title}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {fmtDateTime(e.startsAt)} · {EVENT_FORMAT[e.format]}
                </Text>
              </div>
              {e.my && e.my.registration !== 'INVITED' ? (
                <Badge size="xs" variant="light" color={REGISTRATION[e.my.registration].color} style={{ flexShrink: 0 }}>
                  {REGISTRATION[e.my.registration].label}
                </Badge>
              ) : e.canRegister ? (
                <Button component={Link} to={`/events/${e.id}`} size="compact-xs" variant="light" style={{ flexShrink: 0 }}>
                  Ответить
                </Button>
              ) : null}
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">Запланированных мероприятий нет.</Text>
      )}
    </Tile>
  );
}

function WorkingGroupsTile() {
  const q = useQuery({ queryKey: ['wg-activity'], queryFn: () => api<WgActivity>('/working-groups/my-activity') });
  const d = q.data;
  return (
    <Tile icon={IconUsersGroup} title="Мои рабочие группы" color="grape" to="/working-groups">
      {q.isLoading ? (
        <Text size="sm" c="dimmed">Загрузка…</Text>
      ) : d && d.groups.length ? (
        <Stack gap={8}>
          {d.groups.map((g) => (
            <Group key={g.id} justify="space-between" wrap="nowrap" gap="xs">
              <Anchor component={Link} to={`/working-groups/${g.id}`} size="sm" lineClamp={1}>
                {g.name}
              </Anchor>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                {g.role === 'LEAD' && <Badge size="xs" variant="light" color="grape">рук.</Badge>}
                <Badge size="xs" variant="light" color={g.tasks.overdue ? 'red' : 'gray'}>
                  задач {g.tasks.open}
                </Badge>
              </Group>
            </Group>
          ))}
          {d.myTasks.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" mt={4}>
                МОИ ЗАДАЧИ
              </Text>
              {d.myTasks.slice(0, 4).map((t) => (
                <Group key={t.id} justify="space-between" wrap="nowrap" gap="xs">
                  <Anchor component={Link} to={`/working-groups/${t.workingGroup.id}?tab=tasks&task=${t.id}`} size="sm" lineClamp={1}>
                    {t.title}
                  </Anchor>
                  {t.dueDate && (
                    <Text size="xs" c={t.overdue ? 'red' : 'dimmed'} style={{ flexShrink: 0 }}>
                      до {fmtDay(t.dueDate)}
                    </Text>
                  )}
                </Group>
              ))}
            </>
          )}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          Вы пока не участвуете в рабочих группах. <Anchor component={Link} to="/working-groups">Посмотреть группы</Anchor>
        </Text>
      )}
    </Tile>
  );
}

function ActivityTile() {
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ['events', 'stats', String(year)], queryFn: () => api<EventStats>(`/events/stats?year=${year}`) });
  const rating = (q.data?.rating ?? []).filter((r) => r.score !== null);
  const top = rating.slice(0, 3);
  const low = rating.length > 5 ? rating.slice(-2) : [];
  const row = (r: (typeof rating)[number]) => (
    <Group key={r.organizationId} justify="space-between" wrap="nowrap" gap="xs">
      <Anchor component={Link} to={`/organizations/${r.organizationId}`} size="sm" lineClamp={1}>
        {r.name}
      </Anchor>
      <Text size="sm" fw={600} style={{ flexShrink: 0 }}>
        {Math.round(r.score ?? 0)}%
      </Text>
    </Group>
  );
  return (
    <Tile icon={IconChartBar} title={`Активность членов, ${year}`} color="cyan" to="/events?tab=stats">
      {q.isLoading ? (
        <Text size="sm" c="dimmed">Загрузка…</Text>
      ) : q.data ? (
        <Stack gap={6}>
          <Text size="xs" c="dimmed">
            Посещаемость {q.data.totals.averageAttendance === null ? '—' : `${Math.round(q.data.totals.averageAttendance)}%`} · явка на голосованиях{' '}
            {q.data.totals.averageTurnout === null ? '—' : `${Math.round(q.data.totals.averageTurnout)}%`}
          </Text>
          {top.map(row)}
          {low.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" mt={4}>
                НИЖЕ ВСЕГО
              </Text>
              {low.map(row)}
            </>
          )}
        </Stack>
      ) : null}
    </Tile>
  );
}

function MyDuesTile() {
  const q = useQuery({ queryKey: ['dues', 'my'], queryFn: () => api<{ year: number; dues: DuesRow | null; previousDebt: number } | null>('/dues/my') });
  const d = q.data?.dues;
  const previousDebt = q.data?.previousDebt ?? 0;
  const prev = previousDebt > 0 && (
    <Text size="xs" c="red" fw={500}>
      Долг за прошлые годы: {fmtRub(previousDebt)}
    </Text>
  );
  return (
    <Tile icon={IconCoin} title={`Мой взнос за ${q.data?.year ?? new Date().getFullYear()} год`} color="orange" to="/dues">
      {q.isLoading ? (
        <Text size="sm" c="dimmed">Загрузка…</Text>
      ) : d ? (
        <Stack gap={6}>
          <Group justify="space-between">
            <Badge color={DUES_STATUS[d.status].color} variant="light">{DUES_STATUS[d.status].label}</Badge>
            <Text size="sm" c="dimmed">срок {fmtDay(d.dueDate)}</Text>
          </Group>
          <Text size="sm">
            Оплачено {fmtRub(d.paid)} из {fmtRub(d.amountDue)}
            {d.debt > 0 && d.status !== 'WAIVED' && <Text span fw={600} c={d.status === 'OVERDUE' ? 'red' : undefined}> · к оплате {fmtRub(d.debt)}</Text>}
          </Text>
          {prev}
        </Stack>
      ) : (
        <Stack gap={6}>
          <Text size="sm" c="dimmed">Взнос за этот год ещё не начислен.</Text>
          {prev}
        </Stack>
      )}
    </Tile>
  );
}

function DuesSummaryTile() {
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ['dues', 'summary-tile', year], queryFn: () => api<Page<DuesRow> & { summary: DuesSummary }>(`/dues?year=${year}&pageSize=1`) });
  const s = q.data?.summary;
  return (
    <Tile icon={IconCoin} title={`Взносы за ${year} год`} color="orange" to="/dues">
      {s ? (
        <Stack gap={6}>
          <Text size="sm">
            Оплатили <b>{s.counts.PAID}</b> из {s.accrued - s.counts.WAIVED} · собрано {fmtRub(s.totalPaid)}
          </Text>
          <Progress value={s.totalDue ? Math.min(100, (s.totalPaid / s.totalDue) * 100) : 0} color="teal" size="sm" />
          <Text size="xs" c={s.counts.OVERDUE ? 'red' : 'dimmed'}>
            Долг {fmtRub(s.totalDebt)} · просрочено: {s.counts.OVERDUE}
          </Text>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">Загрузка…</Text>
      )}
    </Tile>
  );
}

export function DashboardPage() {
  const me = useMe();
  const { can } = useAuth();
  const counts = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: async () => {
      const [members, candidates, partners] = await Promise.all(
        (['MEMBER', 'CANDIDATE', 'PARTNER'] as const).map((s) => api<Page<Organization>>(`/organizations?status=${s}&pageSize=1`)),
      );
      return { members: members.total, candidates: candidates.total, partners: partners.total };
    },
  });

  const greeting = me.fullName.split(' ').slice(1, 3).join(' ') || me.fullName;
  return (
    <Stack>
      <div>
        <Title order={2}>Здравствуйте, {greeting}!</Title>
        <Group gap="xs" mt={4}>
          {me.organization && <Text c="dimmed">{me.organization.shortName || me.organization.name}</Text>}
          {me.organization && <StatusBadge status={me.organization.status} />}
          {me.systemRole !== 'USER' && <Badge variant="outline">{SYSTEM_ROLE[me.systemRole]}</Badge>}
          {me.canViewAll && <Badge variant="outline" color="grape">Особые права: видит всё</Badge>}
        </Group>
      </div>

      {me.organization?.status === 'CANDIDATE' && (
        <Alert icon={<IconInfoCircle />} color="yellow">
          Ваша заявка на вступление в Альянс рассматривается. Пока доступны профиль организации и карта участников.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        <Tile icon={IconBuilding} title="Участники Альянса" to="/organizations">
          {counts.data ? (
            <Group gap="lg">
              <div>
                <Text size="xl" fw={700}>
                  {counts.data.members}
                </Text>
                <Text size="xs" c="dimmed">
                  членов
                </Text>
              </div>
              <div>
                <Text size="xl" fw={700}>
                  {counts.data.candidates}
                </Text>
                <Text size="xs" c="dimmed">
                  кандидатов
                </Text>
              </div>
              <div>
                <Text size="xl" fw={700}>
                  {counts.data.partners}
                </Text>
                <Text size="xs" c="dimmed">
                  партнёров
                </Text>
              </div>
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              Загрузка…
            </Text>
          )}
        </Tile>
        {(can('vote.cast') || can('votes.read_all')) && <ActiveVotesTile />}
        {can('dues.read_all') ? <DuesSummaryTile /> : can('dues.read_own') ? <MyDuesTile /> : null}
        {(can('events.participate') || can('partner_materials.read')) && <UpcomingEventsTile />}
        {can('wg.participate') && <WorkingGroupsTile />}
        {can('orgs.read_all') && <ActivityTile />}
      </SimpleGrid>
      {me.organization && (
        <Text size="sm">
          Заполните <Anchor component={Link} to="/my-organization">профиль организации</Anchor> и укажите сотрудников, ответственных за мероприятия, взносы и
          участие в рабочих группах.
        </Text>
      )}
    </Stack>
  );
}

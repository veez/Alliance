import { Anchor, Card, Group, Progress, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { EventStats } from '../../api/types';
import { QueryState } from '../../components/common';
import { fmtDate, pct } from '../../labels';
import { EventTypeBadge } from './EventShared';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fw={700} size="xl">
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}

const rateColor = (r: number | null) => (r === null ? "gray" : r >= 70 ? "teal" : r >= 40 ? "yellow" : "red");

export function StatsTab() {
  const now = new Date().getFullYear();
  const [year, setYear] = useState(String(now));
  const q = useQuery({ queryKey: ['events', 'stats', year], queryFn: () => api<EventStats>(`/events/stats?year=${year}`) });
  const s = q.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Посещаемость считается по организациям: организация присутствовала, если отмечен хотя бы один её представитель.
        </Text>
        <Select w={110} value={year} onChange={(v) => setYear(v ?? String(now))} allowDeselect={false} data={[now, now - 1, now - 2].map(String)} />
      </Group>
      <QueryState isLoading={q.isLoading} error={q.error}>
        {s && (
          <>
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <Stat label="Состоялось мероприятий" value={s.totals.eventsHeld} />
              <Stat label="Средняя посещаемость" value={pct(s.totals.averageAttendance)} hint="доля приглашённых организаций" />
              <Stat label="Завершено голосований" value={s.totals.votesClosed} />
              <Stat label="Средняя явка" value={pct(s.totals.averageTurnout)} hint="на голосованиях" />
            </SimpleGrid>

            <Card withBorder padding="lg">
              <Title order={4} mb="xs">
                Рейтинг активности членов Альянса
              </Title>
              <Text size="sm" c="dimmed" mb="md">
                Активность — среднее из доли посещённых мероприятий и доли голосований, в которых организация участвовала.
              </Text>
              <Table.ScrollContainer minWidth={640}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={40}>#</Table.Th>
                      <Table.Th>Организация</Table.Th>
                      <Table.Th w={150}>Мероприятия</Table.Th>
                      <Table.Th w={150}>Голосования</Table.Th>
                      <Table.Th w={180}>Активность</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {s.rating.map((r, i) => (
                      <Table.Tr key={r.organizationId}>
                        <Table.Td>{i + 1}</Table.Td>
                        <Table.Td>
                          <Anchor component={Link} to={`/organizations/${r.organizationId}`} size="sm">
                            {r.name}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {r.events.attended} из {r.events.invited}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {r.votes.voted} из {r.votes.eligible}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <Progress value={r.score ?? 0} color={rateColor(r.score)} w={90} />
                            <Text size="sm" fw={500}>
                              {pct(r.score)}
                            </Text>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Card>

            <Card withBorder padding="lg">
              <Title order={4} mb="md">
                Посещаемость мероприятий
              </Title>
              {s.events.length ? (
                <Stack gap="sm">
                  {s.events.map((e) => {
                    const r = e.invited ? (e.present / e.invited) * 100 : null;
                    return (
                      <div key={e.id}>
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                            <Text size="sm" c="dimmed" w={80} style={{ flexShrink: 0 }}>
                              {fmtDate(e.startsAt)}
                            </Text>
                            <EventTypeBadge type={e.type} />
                            <Anchor component={Link} to={`/events/${e.id}`} size="sm" lineClamp={1}>
                              {e.title}
                            </Anchor>
                          </Group>
                          <Text size="sm" style={{ flexShrink: 0 }}>
                            {e.present} из {e.invited} орг. · {pct(r)}
                          </Text>
                        </Group>
                        <Progress value={r ?? 0} color={rateColor(r)} size="sm" mt={4} />
                      </div>
                    );
                  })}
                </Stack>
              ) : (
                <Text c="dimmed" size="sm">
                  В этом году мероприятий с отметкой присутствия ещё не было.
                </Text>
              )}
            </Card>
          </>
        )}
      </QueryState>
    </Stack>
  );
}

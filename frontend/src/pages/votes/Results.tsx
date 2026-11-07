import { Alert, Badge, Card, Group, Progress, SegmentedControl, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconCircleCheck, IconCircleX, IconHourglass } from '@tabler/icons-react';
import { useState } from 'react';
import type { QuestionResult, VoteDetail } from '../../api/types';
import { fmtDateTime } from '../../labels';

const OUTCOME_COLOR: Record<QuestionResult['outcome']['kind'], string> = {
  ACCEPTED: 'teal',
  WINNER: 'teal',
  RANKED: 'teal',
  REJECTED: 'red',
  NO_QUORUM: 'red',
  TIE: 'orange',
  NO_VOTES: 'gray',
};

export function QuorumCard({ vote }: { vote: VoteDetail }) {
  const r = vote.result;
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Кворум</Title>
        {r.quorumReached ? (
          <Badge color="teal" leftSection={<IconCircleCheck size={12} />}>
            набран
          </Badge>
        ) : vote.status === 'ACTIVE' ? (
          <Badge color="blue" variant="light" leftSection={<IconHourglass size={12} />}>
            пока не набран
          </Badge>
        ) : (
          <Badge color="red" leftSection={<IconCircleX size={12} />}>
            не набран
          </Badge>
        )}
      </Group>
      <Text size="xl" fw={700}>
        {r.participatedCount} <Text span c="dimmed" size="md">из {r.eligibleCount} организаций</Text>
      </Text>
      <Tooltip label={`Требуется ${r.quorumPercent}%`}>
        <Progress.Root size="lg" mt="sm">
          <Progress.Section value={r.turnoutPercent} color={r.quorumReached ? 'teal' : 'blue'}>
            <Progress.Label>{r.turnoutPercent}%</Progress.Label>
          </Progress.Section>
        </Progress.Root>
      </Tooltip>
      <Text size="xs" c="dimmed" mt={6}>
        Требуемый кворум — {r.quorumPercent}% ({Math.ceil((r.quorumPercent * r.eligibleCount) / 100)} орг.)
      </Text>
    </Card>
  );
}

export function QuestionResults({ vote }: { vote: VoteDetail }) {
  const final = vote.status === 'CLOSED';
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="md">
        <Title order={4}>Итоги</Title>
        {!final && (
          <Text size="xs" c="dimmed">
            предварительные · обновляются автоматически
          </Text>
        )}
      </Group>
      <Stack gap="xl">
        {vote.result.questions.map((q, i) => {
          const ranking = q.format === 'RANKING';
          const max = ranking ? Math.max(1, ...q.options.map((o) => o.score ?? 0)) : Math.max(1, q.answeredCount);
          return (
            <div key={q.questionId}>
              <Text fw={500} mb={6}>
                {i + 1}. {q.text}
              </Text>
              <Stack gap={8}>
                {q.options.map((o) => {
                  const value = ranking ? ((o.score ?? 0) / max) * 100 : (o.count / max) * 100;
                  const winner = q.outcome.winnerOptionIds.includes(o.optionId) && q.outcome.kind !== 'NO_QUORUM';
                  return (
                    <div key={o.optionId}>
                      <Group justify="space-between" gap="xs" wrap="nowrap">
                        <Text size="sm" fw={winner ? 600 : 400}>
                          {o.text}
                        </Text>
                        <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                          {ranking ? `${o.score ?? 0} баллов · 1-х мест: ${o.count}` : `${o.count} · ${o.percent}%`}
                        </Text>
                      </Group>
                      <Progress value={value} color={winner ? 'teal' : 'gray'} size="sm" />
                    </div>
                  );
                })}
              </Stack>
              <Alert mt="sm" p="xs" variant={final ? 'filled' : 'light'} color={OUTCOME_COLOR[q.outcome.kind]}>
                <Text size="sm" fw={600} c={final ? 'white' : undefined}>
                  {final
                    ? q.outcome.label
                    : q.outcome.kind === 'NO_QUORUM'
                      ? 'Сейчас: кворум пока не набран'
                      : `Если бы голосование завершилось сейчас: ${q.outcome.label.charAt(0).toLowerCase()}${q.outcome.label.slice(1)}`}
                </Text>
              </Alert>
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}

export function NamedTable({ vote }: { vote: VoteDetail }) {
  const [filter, setFilter] = useState('all');
  const rows = vote.rows.filter((r) => (filter === 'voted' ? r.votedAt : filter === 'not' ? !r.votedAt : true));
  const notVoted = vote.rows.filter((r) => !r.votedAt).length;
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="md">
        <Title order={4}>Поимённые результаты</Title>
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[
            { value: 'all', label: `Все (${vote.rows.length})` },
            { value: 'voted', label: `Голосовали (${vote.rows.length - notVoted})` },
            { value: 'not', label: `Не голосовали (${notVoted})` },
          ]}
        />
      </Group>
      <Table.ScrollContainer minWidth={600}>
        <Table verticalSpacing="xs" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Организация</Table.Th>
              <Table.Th>Голос подан</Table.Th>
              {vote.questions.map((q, i) => (
                <Table.Th key={q.id}>
                  <Tooltip label={q.text} multiline w={300}>
                    <span>Вопрос {i + 1}</span>
                  </Tooltip>
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.organizationId}>
                <Table.Td>
                  <Text size="sm">{r.organizationName}</Text>
                  <Text size="xs" c="dimmed">
                    {r.regionName}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {r.votedAt ? (
                    <>
                      <Text size="xs">{fmtDateTime(r.votedAt)}</Text>
                      <Text size="xs" c="dimmed">
                        {r.votedBy?.fullName}
                      </Text>
                    </>
                  ) : (
                    <Text size="xs" c="dimmed">
                      не голосовала
                    </Text>
                  )}
                </Table.Td>
                {vote.questions.map((q) => {
                  const a = r.answers[q.id] ?? [];
                  return (
                    <Table.Td key={q.id}>
                      <Text size="sm">{q.format === 'RANKING' ? a.map((x) => `${x.rank}. ${x.text}`).join(', ') : a.map((x) => x.text).join(', ')}</Text>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

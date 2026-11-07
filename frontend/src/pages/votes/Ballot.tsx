import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Paper, Radio, Stack, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconCheck } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { VoteDetail, VoteQuestion } from '../../api/types';
import { errorText, notifyOk } from '../../components/common';
import { fmtDateTime } from '../../labels';

type Choice = Record<string, string[]>; // questionId → optionIds (для рейтинга — по порядку)

function initialChoice(vote: VoteDetail): Choice {
  const c: Choice = {};
  for (const q of vote.questions) {
    const mine = vote.my?.answers[q.id];
    if (q.format === 'RANKING') {
      c[q.id] = mine?.length ? [...mine].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map((a) => a.optionId) : q.options.map((o) => o.id);
    } else c[q.id] = mine?.map((a) => a.optionId) ?? [];
  }
  return c;
}

function QuestionInput({ q, value, onChange, disabled }: { q: VoteQuestion; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const text = (id: string) => q.options.find((o) => o.id === id)?.text ?? '';
  if (disabled) {
    // Режим просмотра: только выбранные варианты, крупно
    return (
      <Stack gap={4}>
        {value.map((id, i) => (
          <Group key={id} gap={8} wrap="nowrap">
            {q.format === 'RANKING' ? (
              <Badge variant="light" circle>
                {i + 1}
              </Badge>
            ) : (
              <IconCheck size={16} color="var(--mantine-color-teal-6)" />
            )}
            <Text size="sm" fw={500}>
              {text(id)}
            </Text>
          </Group>
        ))}
      </Stack>
    );
  }
  if (q.format === 'RANKING') {
    const move = (i: number, d: number) => {
      const next = [...value];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      onChange(next);
    };
    return (
      <Stack gap={6}>
        <Text size="xs" c="dimmed">
          Расставьте варианты: вверху — самый предпочтительный.
        </Text>
        {value.map((id, i) => (
          <Paper key={id} withBorder p="xs">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <Badge variant="filled" circle>
                  {i + 1}
                </Badge>
                <Text size="sm">{text(id)}</Text>
              </Group>
              <Group gap={2} wrap="nowrap">
                <ActionIcon variant="subtle" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Выше">
                  <IconArrowUp size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">
                  <IconArrowDown size={16} />
                </ActionIcon>
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>
    );
  }
  if (q.format === 'MULTIPLE') {
    return (
      <Checkbox.Group
        value={value}
        onChange={onChange}
        description={q.minChoices === q.maxChoices ? `Выберите ${q.minChoices}` : `Выберите от ${q.minChoices} до ${q.maxChoices}`}
      >
        <Stack gap={8} mt={6}>
          {q.options.map((o) => (
            <Checkbox key={o.id} value={o.id} label={o.text} disabled={disabled || (!value.includes(o.id) && value.length >= q.maxChoices)} />
          ))}
        </Stack>
      </Checkbox.Group>
    );
  }
  return (
    <Radio.Group value={value[0] ?? null} onChange={(v) => onChange([v])}>
      <Stack gap={8} mt={4}>
        {q.options.map((o) => (
          <Radio key={o.id} value={o.id} label={o.text} disabled={disabled} />
        ))}
      </Stack>
    </Radio.Group>
  );
}

export function Ballot({ vote }: { vote: VoteDetail }) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Choice>(() => initialChoice(vote));
  const [editing, setEditing] = useState(!vote.my?.votedAt);
  const voted = !!vote.my?.votedAt;

  const complete = useMemo(
    () =>
      vote.questions.every((q) => {
        const v = choice[q.id] ?? [];
        if (q.format === 'MULTIPLE') return v.length >= q.minChoices && v.length <= q.maxChoices;
        if (q.format === 'RANKING') return v.length === q.options.length;
        return v.length === 1;
      }),
    [choice, vote.questions],
  );

  const cast = useMutation({
    mutationFn: () =>
      api(`/votes/${vote.id}/ballot`, {
        method: 'POST',
        body: {
          answers: vote.questions.map((q) => (q.format === 'RANKING' ? { questionId: q.id, ranking: choice[q.id] } : { questionId: q.id, optionIds: choice[q.id] })),
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['vote', vote.id] });
      qc.invalidateQueries({ queryKey: ['votes'] });
      setEditing(false);
      notifyOk(voted ? 'Голос изменён' : 'Голос принят');
    },
  });

  const confirm = () =>
    modals.openConfirmModal({
      title: voted ? 'Изменить голос организации?' : 'Подтвердите голос',
      children: (
        <Stack gap={4}>
          {vote.questions.map((q, i) => (
            <Text size="sm" key={q.id}>
              {i + 1}. {q.format === 'RANKING' ? choice[q.id].map((id, r) => `${r + 1}) ${q.options.find((o) => o.id === id)?.text}`).join('; ') : choice[q.id].map((id) => q.options.find((o) => o.id === id)?.text).join(', ')}
            </Text>
          ))}
          <Text size="xs" c="dimmed" mt="xs">
            Голос подаётся от имени вашей организации и виден всем участникам. До окончания голосования его можно изменить.
          </Text>
        </Stack>
      ),
      labels: { confirm: voted ? 'Изменить' : 'Проголосовать', cancel: 'Отмена' },
      onConfirm: () => cast.mutate(),
    });

  return (
    <Card withBorder padding="lg" style={{ borderColor: editing ? 'var(--mantine-color-brand-4)' : undefined }}>
      <Group justify="space-between" mb="md">
        <Title order={4}>{voted ? 'Голос вашей организации' : 'Бюллетень'}</Title>
        {voted && (
          <Badge color="teal" leftSection={<IconCheck size={12} />} variant="light">
            учтён {fmtDateTime(vote.my!.votedAt)}
          </Badge>
        )}
      </Group>
      <Stack gap="lg">
        {vote.questions.map((q, i) => (
          <div key={q.id}>
            <Text fw={500} mb={4}>
              {i + 1}. {q.text}
            </Text>
            <QuestionInput q={q} value={choice[q.id] ?? []} onChange={(v) => setChoice((c) => ({ ...c, [q.id]: v }))} disabled={!editing} />
          </div>
        ))}
        {cast.error && <Alert color="red">{errorText(cast.error)}</Alert>}
        <Group justify="space-between">
          {voted && vote.my?.votedBy && (
            <Text size="xs" c="dimmed">
              Голос подал(а): {vote.my.votedBy.fullName}
            </Text>
          )}
          {editing ? (
            <Group ml="auto">
              {voted && (
                <Button variant="default" onClick={() => (setChoice(initialChoice(vote)), setEditing(false))}>
                  Отмена
                </Button>
              )}
              <Button onClick={confirm} disabled={!complete} loading={cast.isPending}>
                {voted ? 'Сохранить новый голос' : 'Проголосовать'}
              </Button>
            </Group>
          ) : (
            <Button variant="light" ml="auto" onClick={() => setEditing(true)}>
              Изменить голос
            </Button>
          )}
        </Group>
      </Stack>
    </Card>
  );
}

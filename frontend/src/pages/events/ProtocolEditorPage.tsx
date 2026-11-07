import { ActionIcon, Anchor, Button, Card, Checkbox, Group, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useWorkingGroupsBrief } from '../../api/hooks';
import type { EventDetail, Page, ProtocolDetail, VoteListItem } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';

interface Item {
  key: string;
  agendaText: string;
  discussion: string;
  decision: string;
  voteId: string | null;
}
interface Values {
  title: string;
  number: string;
  heldAt: Date | null;
  workingGroupId: string | null;
  visibleToPartners: boolean;
  items: Item[];
}

let seq = 0;
const newItem = (agendaText = ''): Item => ({ key: `i${++seq}`, agendaText, discussion: '', decision: '', voteId: null });

/** Пункты повестки из описания мероприятия: строки вида «1. …» */
function agendaFromDescription(d: string | null): Item[] {
  const lines = (d ?? '').split('\n').map((l) => l.trim()).filter((l) => /^\d+[.)]\s+/.test(l));
  return lines.length ? lines.map((l) => newItem(l.replace(/^\d+[.)]\s+/, ''))) : [newItem()];
}

export function ProtocolEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const eventId = params.get('eventId');
  const groupParam = params.get('workingGroupId');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const groups = useWorkingGroupsBrief();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const existing = useQuery({ queryKey: ['protocol', id], queryFn: () => api<ProtocolDetail>(`/protocols/${id}`), enabled: !!id });
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => api<EventDetail>(`/events/${eventId}`), enabled: !!eventId && !id });
  const votes = useQuery({
    queryKey: ['votes', 'for-protocol'],
    queryFn: async () => {
      const [a, b] = await Promise.all([api<Page<VoteListItem>>('/votes?tab=archive&pageSize=100'), api<Page<VoteListItem>>('/votes?tab=active&pageSize=100')]);
      return [...b.items, ...a.items];
    },
  });

  const form = useForm<Values>({
    initialValues: { title: '', number: '', heldAt: null, workingGroupId: groupParam, visibleToPartners: false, items: [newItem()] },
    validate: {
      title: (v) => (v.trim().length < 3 ? 'Укажите название' : null),
      heldAt: (v) => (v ? null : 'Укажите дату'),
      items: { agendaText: (v) => (v.trim() ? null : 'Укажите вопрос повестки') },
    },
  });

  useEffect(() => {
    if (ready) return;
    if (id && existing.data) {
      const p = existing.data;
      form.setValues({
        title: p.title,
        number: p.number ?? '',
        heldAt: new Date(p.heldAt),
        workingGroupId: p.workingGroup?.id ?? null,
        visibleToPartners: p.visibleToPartners,
        items: p.items.map((i) => ({ key: `i${++seq}`, agendaText: i.agendaText, discussion: i.discussion ?? '', decision: i.decision ?? '', voteId: i.voteId })),
      });
      setReady(true);
    } else if (!id && eventId && event.data) {
      const e = event.data;
      const kind = e.type === 'GENERAL_MEETING' ? 'общего собрания членов Альянса' : e.type === 'WORKING_GROUP_MEETING' ? `заседания ${e.workingGroup?.name ?? 'рабочей группы'}` : `мероприятия «${e.title}»`;
      form.setValues({ title: `Протокол ${kind}`, heldAt: new Date(e.startsAt), workingGroupId: e.workingGroupId, visibleToPartners: e.visibleToPartners, items: agendaFromDescription(e.description) });
      setReady(true);
    } else if (!id && !eventId) {
      form.setFieldValue('heldAt', new Date());
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, event.data]);

  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    const body = {
      title: v.title.trim(),
      number: v.number.trim() || null,
      heldAt: v.heldAt!.toISOString(),
      eventId: id ? existing.data?.eventId ?? null : eventId,
      workingGroupId: v.workingGroupId,
      visibleToPartners: v.visibleToPartners,
      items: v.items.map((i) => ({ agendaText: i.agendaText.trim(), discussion: i.discussion.trim() || undefined, decision: i.decision.trim() || undefined, voteId: i.voteId ?? undefined })),
    };
    try {
      const saved = id ? await api<{ id: string }>(`/protocols/${id}`, { method: 'PATCH', body }) : await api<{ id: string }>('/protocols', { method: 'POST', body });
      await qc.invalidateQueries({ queryKey: ['protocols'] });
      await qc.invalidateQueries({ queryKey: ['protocol', saved.id] });
      await qc.invalidateQueries({ queryKey: ['event'] });
      notifyOk('Черновик протокола сохранён');
      navigate(`/protocols/${saved.id}`);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });

  const move = (i: number, d: number) => form.reorderListItem('items', { from: i, to: i + d });
  const voteOptions = (votes.data ?? []).map((v) => ({ value: v.id, label: `№ ${v.number}. ${v.title}` }));
  const linkedEvent = id ? existing.data?.event : event.data;

  return (
    <QueryState isLoading={(!!id && existing.isLoading) || (!!eventId && !id && event.isLoading)} error={existing.error ?? event.error}>
      <Anchor component={Link} to={id ? `/protocols/${id}` : eventId ? `/events/${eventId}` : '/events?tab=protocols'} size="sm">
        ← Назад
      </Anchor>
      <PageHeader title={id ? 'Редактирование протокола' : 'Новый протокол'} description={linkedEvent ? `Мероприятие: ${linkedEvent.title}` : undefined} />
      <form onSubmit={submit}>
        <Stack>
          <Card withBorder padding="lg">
            <Stack>
              <TextInput label="Название" withAsterisk {...form.getInputProps('title')} />
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Номер" placeholder="Например, 4-ОС/2026" {...form.getInputProps('number')} />
                <DateTimePicker label="Дата заседания (МСК)" withAsterisk valueFormat="DD.MM.YYYY HH:mm" {...form.getInputProps('heldAt')} />
              </SimpleGrid>
              {!linkedEvent && (
                <Select
                  label="Рабочая группа"
                  description="Оставьте пустым для общего протокола Альянса"
                  clearable
                  disabled={!can('protocols.manage')}
                  data={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
                  {...form.getInputProps('workingGroupId')}
                />
              )}
              <Checkbox label="Виден партнёрам Альянса" {...form.getInputProps('visibleToPartners', { type: 'checkbox' })} />
            </Stack>
          </Card>

          <Title order={4}>Повестка и решения</Title>
          {form.values.items.map((it, i) => (
            <Card key={it.key} withBorder padding="lg">
              <Group justify="space-between" mb="xs">
                <Text fw={600}>Вопрос {i + 1}</Text>
                <Group gap={4}>
                  <ActionIcon variant="subtle" disabled={i === 0} onClick={() => move(i, -1)} title="Выше">
                    <IconArrowUp size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" disabled={i === form.values.items.length - 1} onClick={() => move(i, 1)} title="Ниже">
                    <IconArrowDown size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" disabled={form.values.items.length === 1} onClick={() => form.removeListItem('items', i)} title="Удалить вопрос">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
              <Stack gap="sm">
                <Textarea label="Вопрос повестки" withAsterisk autosize minRows={1} {...form.getInputProps(`items.${i}.agendaText`)} />
                <Textarea label="Слушали (ход обсуждения)" autosize minRows={2} {...form.getInputProps(`items.${i}.discussion`)} />
                <Textarea label="Решили" autosize minRows={2} {...form.getInputProps(`items.${i}.decision`)} />
                <Select label="Связанное голосование" placeholder="Нет" clearable searchable data={voteOptions} {...form.getInputProps(`items.${i}.voteId`)} />
              </Stack>
            </Card>
          ))}
          <Group justify="space-between">
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => form.insertListItem('items', newItem())}>
              Добавить вопрос
            </Button>
            <Button type="submit" loading={busy}>
              Сохранить черновик
            </Button>
          </Group>
        </Stack>
      </form>
    </QueryState>
  );
}

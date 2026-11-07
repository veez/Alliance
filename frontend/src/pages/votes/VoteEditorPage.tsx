import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Organization, Page, QuestionFormat, VoteDetail, VoteEligibility, VoteScenario } from '../../api/types';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { QUESTION_FORMAT, VOTE_ELIGIBILITY, VOTE_SCENARIO } from '../../labels';

interface QuestionForm {
  key: string;
  text: string;
  format: QuestionFormat;
  options: string[];
  minChoices: number;
  maxChoices: number;
}

interface FormValues {
  title: string;
  description: string;
  scenario: VoteScenario;
  subjectOrganizationId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  quorumPercent: number;
  eligibility: VoteEligibility;
  organizationIds: string[];
  reminderHours: string[];
  questions: QuestionForm[];
}

const REMINDERS = [
  { value: '72', label: 'за 3 дня' },
  { value: '48', label: 'за 2 дня' },
  { value: '24', label: 'за сутки' },
  { value: '2', label: 'за 2 часа' },
];

const newKey = () => Math.random().toString(36).slice(2);
const emptyQuestion = (format: QuestionFormat = 'YES_NO_ABSTAIN'): QuestionForm => ({ key: newKey(), text: '', format, options: ['', ''], minChoices: 1, maxChoices: 2 });

function toForm(v: VoteDetail): FormValues {
  return {
    title: v.title,
    description: v.description ?? '',
    scenario: v.scenario,
    subjectOrganizationId: v.subjectOrganization?.id ?? null,
    startsAt: v.startsAt ? new Date(v.startsAt) : null,
    endsAt: new Date(v.endsAt),
    quorumPercent: v.quorumPercent,
    eligibility: v.eligibility,
    organizationIds: v.eligibleOrganizationIds,
    reminderHours: v.reminders.map((r) => String(r.beforeHours)),
    questions: v.questions.map((q) => ({
      key: q.id,
      text: q.text,
      format: q.format,
      options: q.format === 'YES_NO_ABSTAIN' ? ['', ''] : q.options.map((o) => o.text),
      minChoices: q.minChoices,
      maxChoices: q.maxChoices,
    })),
  };
}

function QuestionEditor({ form, index }: { form: ReturnType<typeof useForm<FormValues>>; index: number }) {
  const q = form.values.questions[index];
  const path = `questions.${index}`;
  const count = form.values.questions.length;
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>Вопрос {index + 1}</Text>
          <Group gap={4}>
            <ActionIcon variant="subtle" disabled={index === 0} onClick={() => form.reorderListItem('questions', { from: index, to: index - 1 })} aria-label="Выше">
              <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" disabled={index === count - 1} onClick={() => form.reorderListItem('questions', { from: index, to: index + 1 })} aria-label="Ниже">
              <IconArrowDown size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="red" disabled={count === 1} onClick={() => form.removeListItem('questions', index)} aria-label="Удалить вопрос">
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        </Group>
        <Textarea placeholder="Формулировка вопроса" autosize minRows={1} {...form.getInputProps(`${path}.text`)} />
        <Select
          label="Формат ответа"
          allowDeselect={false}
          data={Object.entries(QUESTION_FORMAT).map(([value, label]) => ({ value, label }))}
          {...form.getInputProps(`${path}.format`)}
        />
        {q.format === 'YES_NO_ABSTAIN' ? (
          <Text size="sm" c="dimmed">
            Варианты: «За», «Против», «Воздержался».
          </Text>
        ) : (
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Варианты
            </Text>
            {q.options.map((_, oi) => (
              <Group key={oi} gap={6} wrap="nowrap">
                <TextInput style={{ flex: 1 }} placeholder={`Вариант ${oi + 1}`} {...form.getInputProps(`${path}.options.${oi}`)} />
                <ActionIcon variant="subtle" color="red" disabled={q.options.length <= 2} onClick={() => form.removeListItem(`${path}.options`, oi)} aria-label="Удалить вариант">
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Group>
              <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={() => form.insertListItem(`${path}.options`, '')}>
                Добавить вариант
              </Button>
            </Group>
            {q.format === 'MULTIPLE' && (
              <Group grow>
                <NumberInput label="Минимум выбрать" min={1} max={q.options.length} {...form.getInputProps(`${path}.minChoices`)} />
                <NumberInput label="Максимум выбрать" min={1} max={q.options.length} {...form.getInputProps(`${path}.maxChoices`)} />
              </Group>
            )}
            {q.format === 'RANKING' && (
              <Text size="xs" c="dimmed">
                Участник расставляет все варианты по местам; итог считается методом Борда.
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

export function VoteEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['vote', id], queryFn: () => api<VoteDetail>(`/votes/${id}`), enabled: !!id });
  const members = useQuery({ queryKey: ['organizations', 'members-brief'], queryFn: () => api<Page<Organization>>('/organizations?status=MEMBER&pageSize=200') });
  const candidates = useQuery({ queryKey: ['organizations', 'candidates-brief'], queryFn: () => api<Page<Organization>>('/organizations?status=CANDIDATE&pageSize=200') });

  const form = useForm<FormValues>({
    initialValues: {
      title: '',
      description: '',
      scenario: 'DOCUMENT_APPROVAL',
      subjectOrganizationId: null,
      startsAt: null,
      endsAt: new Date(Date.now() + 7 * 86_400_000),
      quorumPercent: 50,
      eligibility: 'ALL_MEMBERS',
      organizationIds: [],
      reminderHours: ['48', '2'],
      questions: [emptyQuestion()],
    },
    validate: (v) => {
      const errors: Record<string, string> = {};
      if (v.title.trim().length < 3) errors.title = 'Укажите название';
      if (!v.endsAt) errors.endsAt = 'Укажите срок';
      else if (v.startsAt && v.endsAt <= v.startsAt) errors.endsAt = 'Окончание позже начала';
      if (v.scenario === 'ADMISSION' && !v.subjectOrganizationId) errors.subjectOrganizationId = 'Выберите кандидата';
      if (v.eligibility === 'LIST' && !v.organizationIds.length) errors.organizationIds = 'Выберите участников';
      v.questions.forEach((q, i) => {
        if (q.text.trim().length < 3) errors[`questions.${i}.text`] = 'Сформулируйте вопрос';
        if (q.format === 'YES_NO_ABSTAIN') return;
        q.options.forEach((o, j) => {
          if (!o.trim()) errors[`questions.${i}.options.${j}`] = 'Заполните вариант';
        });
        if (q.format === 'MULTIPLE' && q.minChoices > q.maxChoices) errors[`questions.${i}.maxChoices`] = 'Не меньше минимума';
      });
      return errors;
    },
  });

  useEffect(() => {
    if (existing.data) form.setValues(toForm(existing.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  // При выборе сценария «Приём в члены» подставляем типовой вопрос
  useEffect(() => {
    if (form.values.scenario !== 'ADMISSION' || !form.values.subjectOrganizationId) return;
    const org = candidates.data?.items.find((o) => o.id === form.values.subjectOrganizationId);
    if (!org) return;
    if (!form.values.title) form.setFieldValue('title', `Приём в члены Альянса: ${org.name}`);
    if (form.values.questions.length === 1 && !form.values.questions[0].text) {
      form.setFieldValue('questions.0.text', `Принять ${org.name} в члены Альянса «Ценность каждого»?`);
      form.setFieldValue('questions.0.format', 'YES_NO_ABSTAIN');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.scenario, form.values.subjectOrganizationId, candidates.data]);

  const submit = form.onSubmit(async (v) => {
    const body = {
      title: v.title,
      description: v.description || undefined,
      scenario: v.scenario,
      subjectOrganizationId: v.scenario === 'ADMISSION' ? v.subjectOrganizationId : null,
      startsAt: v.startsAt ? v.startsAt.toISOString() : null,
      endsAt: v.endsAt!.toISOString(),
      quorumPercent: v.quorumPercent,
      eligibility: v.eligibility,
      organizationIds: v.eligibility === 'LIST' ? v.organizationIds : undefined,
      reminderHours: v.reminderHours.map(Number),
      questions: v.questions.map((q) => ({
        text: q.text,
        format: q.format,
        options: q.format === 'YES_NO_ABSTAIN' ? undefined : q.options,
        minChoices: q.format === 'MULTIPLE' ? q.minChoices : undefined,
        maxChoices: q.format === 'MULTIPLE' ? q.maxChoices : undefined,
      })),
    };
    try {
      const saved = await api<{ id: string }>(id ? `/votes/${id}` : '/votes', { method: id ? 'PATCH' : 'POST', body });
      await qc.invalidateQueries({ queryKey: ['votes'] });
      await qc.invalidateQueries({ queryKey: ['vote', saved.id] });
      notifyOk('Черновик сохранён');
      navigate(`/votes/${saved.id}`);
    } catch (e) {
      notifyError(e);
    }
  });

  const editingPublished = existing.data && existing.data.status !== 'DRAFT';
  return (
    <QueryState isLoading={!!id && existing.isLoading} error={existing.error}>
      <form onSubmit={submit}>
        <Stack maw={900}>
          <PageHeader title={id ? 'Редактирование черновика' : 'Новое голосование'} description="После публикации вопросы и состав участников не меняются." />
          {editingPublished && <Alert color="orange">Голосование уже опубликовано — редактировать его нельзя.</Alert>}
          <Card withBorder padding="lg">
            <Stack>
              <Select
                label="Вид голосования"
                allowDeselect={false}
                data={Object.entries(VOTE_SCENARIO).map(([value, label]) => ({ value, label }))}
                {...form.getInputProps('scenario')}
              />
              {form.values.scenario === 'ADMISSION' && (
                <Select
                  label="Кандидат"
                  description="Кандидат не увидит это голосование до его завершения"
                  searchable
                  data={(candidates.data?.items ?? []).map((o) => ({ value: o.id, label: o.name }))}
                  nothingFoundMessage="Нет кандидатов"
                  {...form.getInputProps('subjectOrganizationId')}
                />
              )}
              <TextInput label="Название" withAsterisk {...form.getInputProps('title')} />
              <Textarea label="Пояснение для участников" autosize minRows={2} maxRows={10} {...form.getInputProps('description')} />
              {form.values.scenario === 'DOCUMENT_APPROVAL' && (
                <Text size="sm" c="dimmed">
                  Файл документа прикладывается после сохранения черновика, на странице голосования.
                </Text>
              )}
            </Stack>
          </Card>

          <Card withBorder padding="lg">
            <Title order={5} mb="sm">
              Сроки и участники
            </Title>
            <Stack>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <DateTimePicker label="Начало" placeholder="С момента публикации" clearable valueFormat="DD.MM.YYYY HH:mm" {...form.getInputProps('startsAt')} />
                <DateTimePicker label="Окончание (МСК)" withAsterisk valueFormat="DD.MM.YYYY HH:mm" minDate={new Date()} {...form.getInputProps('endsAt')} />
                <NumberInput label="Кворум, %" description="Доля проголосовавших организаций" min={0} max={100} {...form.getInputProps('quorumPercent')} />
              </SimpleGrid>
              <Select
                label="Кто голосует"
                allowDeselect={false}
                data={Object.entries(VOTE_ELIGIBILITY).map(([value, label]) => ({ value, label }))}
                description="Состав фиксируется в момент публикации"
                {...form.getInputProps('eligibility')}
              />
              {form.values.eligibility === 'LIST' && (
                <MultiSelect
                  label="Участники"
                  searchable
                  data={(members.data?.items ?? []).map((o) => ({ value: o.id, label: o.shortName || o.name }))}
                  {...form.getInputProps('organizationIds')}
                />
              )}
              <Checkbox.Group label="Напоминать не проголосовавшим по email" {...form.getInputProps('reminderHours')}>
                <Group mt={6}>
                  {REMINDERS.map((r) => (
                    <Checkbox key={r.value} value={r.value} label={r.label} />
                  ))}
                </Group>
              </Checkbox.Group>
            </Stack>
          </Card>

          <Title order={4}>Вопросы</Title>
          {form.values.questions.map((q, i) => (
            <QuestionEditor key={q.key} form={form} index={i} />
          ))}
          <Group>
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => form.insertListItem('questions', emptyQuestion('SINGLE'))}>
              Добавить вопрос
            </Button>
          </Group>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => navigate(-1)}>
              Отмена
            </Button>
            <Button type="submit" loading={form.submitting} disabled={!!editingPublished}>
              Сохранить черновик
            </Button>
          </Group>
        </Stack>
      </form>
    </QueryState>
  );
}

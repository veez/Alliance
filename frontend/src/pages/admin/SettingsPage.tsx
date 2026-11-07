import { Badge, Button, Card, Code, Grid, Group, NavLink, NumberInput, Stack, Tabs, TagsInput, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { fmtDateTime } from '../../labels';

interface PortalSettings {
  defaultQuorumPercent: number;
  voteReminderHours: number[];
  duesReminderDaysBefore: number[];
}
interface Template {
  code: string;
  name: string;
  subject: string;
  bodyHtml: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; fullName: string } | null;
  variables: string[];
}

const toNums = (v: string[]) => v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);

function GeneralSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<PortalSettings>('/admin/settings') });
  const form = useForm({ initialValues: { defaultQuorumPercent: 50 as number | string, voteReminderHours: [] as string[], duesReminderDaysBefore: [] as string[] } });
  useEffect(() => {
    if (q.data) {
      const v = { defaultQuorumPercent: q.data.defaultQuorumPercent, voteReminderHours: q.data.voteReminderHours.map(String), duesReminderDaysBefore: q.data.duesReminderDaysBefore.map(String) };
      form.setValues(v);
      form.resetDirty(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const [busy, setBusy] = useState(false);
  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    try {
      const res = await api<PortalSettings>('/admin/settings', {
        method: 'PUT',
        body: { defaultQuorumPercent: Number(v.defaultQuorumPercent), voteReminderHours: toNums(v.voteReminderHours), duesReminderDaysBefore: toNums(v.duesReminderDaysBefore) },
      });
      qc.setQueryData(['admin-settings'], res);
      notifyOk('Настройки сохранены');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });
  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      <form onSubmit={submit}>
        <Stack maw={640}>
          <Card withBorder padding="lg">
            <Title order={5} mb="sm">
              Голосования
            </Title>
            <Stack>
              <NumberInput label="Кворум по умолчанию, %" description="Подставляется в новые голосования; секретарь может изменить для конкретного голосования" min={1} max={100} {...form.getInputProps('defaultQuorumPercent')} />
              <TagsInput
                label="Напоминания по умолчанию, часов до окончания"
                description="Введите число и нажмите Enter. Напоминание получают организации, которые ещё не проголосовали"
                {...form.getInputProps('voteReminderHours')}
              />
            </Stack>
          </Card>
          <Card withBorder padding="lg">
            <Title order={5} mb="sm">
              Взносы
            </Title>
            <Text size="sm" c="dimmed" mb="sm">
              Суммы, сроки и льготный период задаются по годам в разделе «Взносы» → «Настройки года».
            </Text>
            <TagsInput label="Напоминания до срока оплаты, дней" description="После срока напоминания приходят в первый день просрочки и далее раз в 14 дней" {...form.getInputProps('duesReminderDaysBefore')} />
          </Card>
          <Group justify="flex-end">
            <Button type="submit" disabled={!form.isDirty()} loading={busy}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </QueryState>
  );
}

function TemplateEditor({ t }: { t: Template }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(t.subject);
  const [bodyHtml, setBodyHtml] = useState(t.bodyHtml);
  const [busy, setBusy] = useState(false);
  const [dSubject] = useDebouncedValue(subject, 400);
  const [dBody] = useDebouncedValue(bodyHtml, 400);
  useEffect(() => {
    setSubject(t.subject);
    setBodyHtml(t.bodyHtml);
  }, [t]);
  const preview = useQuery({
    queryKey: ['tpl-preview', t.code, dSubject, dBody],
    queryFn: () => api<{ subject: string; html: string }>(`/admin/email-templates/${t.code}/preview`, { method: 'POST', body: { subject: dSubject, bodyHtml: dBody } }),
    enabled: dSubject.length >= 3 && dBody.length >= 10,
  });
  const dirty = subject !== t.subject || bodyHtml !== t.bodyHtml;
  const save = async (reset = false) => {
    setBusy(true);
    try {
      if (reset) await api(`/admin/email-templates/${t.code}/reset`, { method: 'POST' });
      else await api(`/admin/email-templates/${t.code}`, { method: 'PUT', body: { subject, bodyHtml } });
      await qc.invalidateQueries({ queryKey: ['email-templates'] });
      notifyOk(reset ? 'Восстановлен текст по умолчанию' : 'Шаблон сохранён');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={4}>{t.name}</Title>
          <Text size="xs" c="dimmed">
            {t.isDefault ? 'Текст по умолчанию' : `Изменён${t.updatedBy ? `: ${t.updatedBy.fullName}` : ''}${t.updatedAt ? `, ${fmtDateTime(t.updatedAt)}` : ''}`}
          </Text>
        </div>
        <Group gap="xs">
          {!t.isDefault && (
            <Button variant="subtle" color="gray" onClick={() => save(true)} loading={busy}>
              Вернуть по умолчанию
            </Button>
          )}
          <Button disabled={!dirty} onClick={() => save()} loading={busy}>
            Сохранить
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        Переменные:{' '}
        {t.variables.map((v) => (
          <Code key={v} mr={4}>{`{{${v}}}`}</Code>
        ))}
        — значения экранируются автоматически.
      </Text>
      <TextInput label="Тема письма" value={subject} onChange={(e) => setSubject(e.currentTarget.value)} />
      <Textarea label="Текст (HTML)" autosize minRows={6} maxRows={16} value={bodyHtml} onChange={(e) => setBodyHtml(e.currentTarget.value)} styles={{ input: { fontFamily: 'monospace', fontSize: 13 } }} />
      <Card withBorder padding="sm">
        <Text size="xs" c="dimmed" mb={4}>
          Предпросмотр с примерными данными
        </Text>
        <Text size="sm" fw={600} mb="xs">
          {preview.data?.subject ?? '…'}
        </Text>
        {/* sandbox без разрешений: скрипты и переходы в предпросмотре запрещены */}
        <iframe title="Предпросмотр письма" sandbox="" srcDoc={`<meta charset="utf-8"><body style="font-family:sans-serif;font-size:14px">${preview.data?.html ?? ''}</body>`} style={{ width: '100%', minHeight: 220, border: 0, background: 'white' }} />
      </Card>
    </Stack>
  );
}

function EmailTemplates() {
  const q = useQuery({ queryKey: ['email-templates'], queryFn: () => api<Template[]>('/admin/email-templates') });
  const [code, setCode] = useState<string | null>(null);
  const current = q.data?.find((t) => t.code === code) ?? q.data?.[0];
  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      <Grid>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Card withBorder padding={4}>
            {q.data?.map((t) => (
              <NavLink
                key={t.code}
                label={t.name}
                active={current?.code === t.code}
                onClick={() => setCode(t.code)}
                rightSection={!t.isDefault ? <Badge size="xs" variant="light">изм.</Badge> : null}
              />
            ))}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>{current && <TemplateEditor t={current} />}</Grid.Col>
      </Grid>
    </QueryState>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'general';
  return (
    <>
      <PageHeader title="Настройки портала" description="Значения по умолчанию и тексты писем. Все изменения записываются в журнал аудита." />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'general' })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="general">Общие</Tabs.Tab>
          <Tabs.Tab value="templates">Шаблоны писем</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general">
          <GeneralSettings />
        </Tabs.Panel>
        <Tabs.Panel value="templates">
          <EmailTemplates />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

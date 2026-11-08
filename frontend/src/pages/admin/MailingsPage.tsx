import { Alert, Badge, Button, Card, Select, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconSend } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../api/client';
import type { EventAudience, Page } from '../../api/types';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { EVENT_AUDIENCE, fmtDateTime } from '../../labels';

interface Mailing {
  id: string;
  audience: EventAudience;
  subject: string;
  body: string;
  recipients: number;
  createdAt: string;
  createdBy: { id: string; fullName: string };
}

const GROUPS = (Object.keys(EVENT_AUDIENCE) as EventAudience[]).map((value) => ({ value, label: EVENT_AUDIENCE[value] }));

export function MailingsPage() {
  const qc = useQueryClient();
  const form = useForm({
    initialValues: { audience: 'BOARD' as EventAudience, subject: '', body: '' },
    validate: {
      subject: (v) => (v.trim().length >= 3 ? null : 'Укажите тему'),
      body: (v) => (v.trim() ? null : 'Напишите текст сообщения'),
    },
  });
  const audience = form.values.audience;
  const count = useQuery({
    queryKey: ['mailing-recipients', audience],
    queryFn: () => api<{ count: number; emailEnabled: boolean }>(`/mailings/recipients${qs({ audience })}`),
  });
  const history = useQuery({ queryKey: ['mailings'], queryFn: () => api<Page<Mailing>>('/mailings?pageSize=50') });
  const send = useMutation({
    mutationFn: (v: typeof form.values) => api('/mailings', { method: 'POST', body: v }),
    onSuccess: () => {
      form.reset();
      qc.invalidateQueries({ queryKey: ['mailings'] });
      notifyOk('Рассылка отправлена');
    },
    onError: notifyError,
  });
  const total = count.data?.count ?? 0;
  const confirm = form.onSubmit((v) => {
    modals.openConfirmModal({
      title: 'Отправить рассылку?',
      children: (
        <Text size="sm">
          «{v.subject.trim()}» получат: {EVENT_AUDIENCE[v.audience].toLowerCase()}, всего {total}. Отменить отправку будет нельзя.
        </Text>
      ),
      labels: { confirm: 'Отправить', cancel: 'Отмена' },
      onConfirm: () => send.mutate(v),
    });
  });

  return (
    <Stack>
      <PageHeader title="Рассылки" description="Сообщения выбранной группе без привязки к мероприятию" />
      {count.data && !count.data.emailEnabled && (
        <Alert color="yellow">Отправка почты ещё не настроена: сообщение придёт получателям только в портале.</Alert>
      )}
      <Card withBorder padding="lg" maw={720}>
        <form onSubmit={confirm}>
          <Stack>
            <Select label="Кому" data={GROUPS} allowDeselect={false} {...form.getInputProps('audience')} />
            <TextInput label="Тема" withAsterisk maxLength={200} {...form.getInputProps('subject')} />
            <Textarea label="Текст сообщения" withAsterisk autosize minRows={5} maxRows={16} maxLength={20000} {...form.getInputProps('body')} />
            <Text size="sm" c="dimmed">
              Получателей: {total}. Сообщение приходит только тем, кто принял приглашение в портал.
            </Text>
            <Button type="submit" leftSection={<IconSend size={16} />} disabled={!total} loading={send.isPending} style={{ alignSelf: 'flex-end' }}>
              Отправить
            </Button>
          </Stack>
        </form>
      </Card>
      <Title order={4} mt="md">
        История
      </Title>
      <QueryState isLoading={history.isLoading} error={history.error}>
        {history.data?.items.length ? (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Дата</Table.Th>
                  <Table.Th>Кому</Table.Th>
                  <Table.Th>Сообщение</Table.Th>
                  <Table.Th ta="right">Получателей</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {history.data.items.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td>
                      <Text size="sm">{fmtDateTime(m.createdAt)}</Text>
                      <Text size="xs" c="dimmed">
                        {m.createdBy.fullName}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" style={{ textTransform: 'none' }}>
                        {EVENT_AUDIENCE[m.audience]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {m.subject}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {m.body}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">{m.recipients}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            Рассылок пока не было.
          </Text>
        )}
      </QueryState>
    </Stack>
  );
}

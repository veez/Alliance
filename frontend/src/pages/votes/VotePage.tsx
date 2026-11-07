import { ActionIcon, Alert, Anchor, Badge, Button, Card, FileButton, Grid, Group, Menu, Modal, Stack, Text, Title } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { modals } from '@mantine/modals';
import {
  IconArrowLeft,
  IconClockHour4,
  IconDots,
  IconDownload,
  IconFileText,
  IconInfoCircle,
  IconPaperclip,
  IconPencil,
  IconSend,
  IconTrash,
  IconUserCheck,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../api/client';
import type { VoteDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, QueryState } from '../../components/common';
import { fmtDateTime, timeLeft, VOTE_ELIGIBILITY, VOTE_SCENARIO } from '../../labels';
import { Ballot } from './Ballot';
import { NamedTable, QuestionResults, QuorumCard } from './Results';
import { VoteStatusBadge } from './VotesPage';

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);

function Attachments({ vote }: { vote: VoteDetail }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const editable = vote.canManage && vote.status === 'DRAFT';
  if (!vote.attachments.length && !editable) return null;

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api(`/votes/${vote.id}/files`, { method: 'POST', body: fd });
      await qc.invalidateQueries({ queryKey: ['vote', vote.id] });
      notifyOk('Файл приложен');
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (fileId: string) => {
    try {
      await api(`/votes/${vote.id}/files/${fileId}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['vote', vote.id] });
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Документы</Title>
        {editable && (
          <FileButton onChange={upload}>
            {(props) => (
              <Button {...props} size="xs" variant="light" leftSection={<IconPaperclip size={14} />} loading={busy}>
                Приложить файл
              </Button>
            )}
          </FileButton>
        )}
      </Group>
      <Stack gap={6}>
        {vote.attachments.map((f) => (
          <Group key={f.id} justify="space-between" wrap="nowrap">
            <Anchor size="sm" onClick={() => downloadFile(`/votes/${vote.id}/files/${f.id}`, f.originalName).catch(notifyError)}>
              <Group gap={6} wrap="nowrap">
                <IconFileText size={16} /> {f.originalName}
              </Group>
            </Anchor>
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="dimmed">
                {fmtSize(f.size)}
              </Text>
              {editable && (
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove(f.id)} aria-label="Удалить файл">
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </Group>
          </Group>
        ))}
        {!vote.attachments.length && (
          <Text size="sm" c="dimmed">
            Файлы прикладываются до публикации — участники голосуют по неизменному документу.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

function ExtendModal({ vote, opened, onClose }: { vote: VoteDetail; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [endsAt, setEndsAt] = useState<Date | null>(new Date(new Date(vote.endsAt).getTime() + 86_400_000));
  const extend = useMutation({
    mutationFn: () => api(`/votes/${vote.id}/extend`, { method: 'POST', body: { endsAt: endsAt!.toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vote', vote.id] });
      notifyOk('Срок продлён');
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Продлить голосование">
      <Stack>
        <DateTimePicker label="Новый срок окончания (МСК)" value={endsAt} onChange={setEndsAt} minDate={new Date()} valueFormat="DD.MM.YYYY HH:mm" />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => extend.mutate()} loading={extend.isPending} disabled={!endsAt}>
            Продлить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AdmitCandidate({ vote }: { vote: VoteDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const subject = vote.subjectOrganization;
  const accepted = vote.result.questions.every((q) => q.outcome.kind === 'ACCEPTED');
  const admit = useMutation({
    mutationFn: (status: 'MEMBER' | 'EXITED') =>
      api(`/organizations/${subject!.id}/status`, { method: 'POST', body: { status, voteId: vote.id, reason: `По итогам голосования № ${vote.number}` } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vote', vote.id] });
      notifyOk('Статус организации изменён');
    },
    onError: notifyError,
  });
  if (vote.scenario !== 'ADMISSION' || vote.status !== 'CLOSED' || !subject || !can('orgs.manage') || subject.status !== 'CANDIDATE') return null;
  return (
    <Alert color={accepted ? 'teal' : 'orange'} icon={<IconUserCheck />} title={accepted ? 'Решение о приёме принято' : 'Решение о приёме не принято'}>
      <Group justify="space-between">
        <Text size="sm">
          {subject.name} — сейчас в статусе кандидата.
        </Text>
        {accepted ? (
          <Button size="xs" onClick={() => admit.mutate('MEMBER')} loading={admit.isPending}>
            Перевести в члены Альянса
          </Button>
        ) : (
          <Button size="xs" color="orange" variant="light" onClick={() => admit.mutate('EXITED')} loading={admit.isPending}>
            Отклонить заявку
          </Button>
        )}
      </Group>
    </Alert>
  );
}

export function VotePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [extendOpen, setExtendOpen] = useState(false);
  const vote = useQuery({
    queryKey: ['vote', id],
    queryFn: () => api<VoteDetail>(`/votes/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'ACTIVE' ? 15_000 : false),
  });

  const action = useMutation({
    mutationFn: (path: string) => api(`/votes/${id}/${path}`, { method: 'POST' }),
    onSuccess: (_, path) => {
      qc.invalidateQueries({ queryKey: ['vote', id] });
      qc.invalidateQueries({ queryKey: ['votes'] });
      notifyOk({ publish: 'Голосование опубликовано, участники получили уведомления', close: 'Голосование завершено, протокол сформирован', cancel: 'Голосование отменено' }[path] ?? 'Готово');
    },
    onError: notifyError,
  });
  const confirm = (title: string, text: string, path: string, danger = false) =>
    modals.openConfirmModal({
      title,
      children: <Text size="sm">{text}</Text>,
      labels: { confirm: 'Подтвердить', cancel: 'Отмена' },
      confirmProps: { color: danger ? 'red' : undefined },
      onConfirm: () => action.mutate(path),
    });

  const v = vote.data;
  return (
    <Stack>
      <Anchor component={Link} to="/votes" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Все голосования
        </Group>
      </Anchor>
      <QueryState isLoading={vote.isLoading} error={vote.error}>
        {v && (
          <>
            <Group justify="space-between" align="flex-start">
              <div style={{ flex: 1, minWidth: 260 }}>
                <Text size="sm" c="dimmed">
                  Голосование № {v.number} · {VOTE_SCENARIO[v.scenario]} · открытое
                </Text>
                <Title order={2}>{v.title}</Title>
                <Group gap="xs" mt={6}>
                  <VoteStatusBadge status={v.status} />
                  {v.status === 'ACTIVE' && (
                    <Badge variant="outline" leftSection={<IconClockHour4 size={12} />}>
                      до {fmtDateTime(v.endsAt)} · {timeLeft(v.endsAt)}
                    </Badge>
                  )}
                  {v.status === 'CLOSED' && <Text size="sm" c="dimmed">завершено {fmtDateTime(v.closedAt)}</Text>}
                </Group>
              </div>
              <Group gap="xs">
                {v.status === 'CLOSED' && (
                  <Button leftSection={<IconDownload size={16} />} onClick={() => downloadFile(`/votes/${id}/protocol.pdf`, `Протокол ${v.number}.pdf`).catch(notifyError)}>
                    Протокол PDF
                  </Button>
                )}
                {v.canManage && v.status === 'DRAFT' && (
                  <>
                    <Button variant="default" component={Link} to={`/votes/${id}/edit`} leftSection={<IconPencil size={16} />}>
                      Изменить
                    </Button>
                    <Button
                      leftSection={<IconSend size={16} />}
                      loading={action.isPending}
                      onClick={() => confirm('Опубликовать голосование?', 'Состав участников и вопросы будут зафиксированы, участники получат уведомление по email.', 'publish')}
                    >
                      Опубликовать
                    </Button>
                  </>
                )}
                {v.status !== 'DRAFT' && (
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="default" size="lg" aria-label="Ещё">
                        <IconDots size={18} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => downloadFile(`/votes/${id}/export.csv`, `golosovanie-${v.number}.csv`).catch(notifyError)}>
                        Выгрузить результаты (CSV)
                      </Menu.Item>
                      {v.canManage && v.status === 'ACTIVE' && (
                        <>
                          <Menu.Item onClick={() => setExtendOpen(true)}>Продлить срок</Menu.Item>
                          <Menu.Item onClick={() => confirm('Завершить досрочно?', 'Итоги будут подведены сейчас, голоса больше не принимаются.', 'close')}>
                            Завершить досрочно
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item color="red" onClick={() => confirm('Отменить голосование?', 'Голосование будет отменено без подведения итогов.', 'cancel', true)}>
                            Отменить
                          </Menu.Item>
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                )}
                {v.canManage && v.status === 'DRAFT' && (
                  <Button variant="subtle" color="red" onClick={() => confirm('Отменить черновик?', 'Черновик будет перенесён в архив как отменённый.', 'cancel', true)}>
                    Отменить
                  </Button>
                )}
              </Group>
            </Group>

            <AdmitCandidate vote={v} />

            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 7 }}>
                <Stack>
                  {v.description && (
                    <Card withBorder padding="lg">
                      <Text className="pre-wrap" size="sm">
                        {v.description}
                      </Text>
                    </Card>
                  )}
                  <Attachments vote={v} />
                  {v.canVote && <Ballot key={v.my?.votedAt ?? 'new'} vote={v} />}
                  {!v.canVote && v.status === 'ACTIVE' && v.cannotVoteReason && (
                    <Alert icon={<IconInfoCircle />} color="gray">
                      {v.cannotVoteReason}
                    </Alert>
                  )}
                  {v.status === 'DRAFT' && (
                    <Card withBorder padding="lg">
                      <Title order={5} mb="sm">
                        Вопросы
                      </Title>
                      <Stack gap="xs">
                        {v.questions.map((q, i) => (
                          <Text size="sm" key={q.id}>
                            {i + 1}. {q.text} <Text span c="dimmed">({q.options.map((o) => o.text).join(' / ')})</Text>
                          </Text>
                        ))}
                      </Stack>
                    </Card>
                  )}
                  {v.status !== 'DRAFT' && <QuestionResults vote={v} />}
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <Stack>
                  {v.status !== 'DRAFT' && <QuorumCard vote={v} />}
                  <Card withBorder padding="lg">
                    <Title order={5} mb="sm">
                      Параметры
                    </Title>
                    <Stack gap={6}>
                      <Text size="sm">
                        <Text span c="dimmed">Участники: </Text>
                        {VOTE_ELIGIBILITY[v.eligibility]}
                      </Text>
                      <Text size="sm">
                        <Text span c="dimmed">Период: </Text>
                        {v.startsAt ? fmtDateTime(v.startsAt) : 'с момента публикации'} — {fmtDateTime(v.endsAt)}
                      </Text>
                      <Text size="sm">
                        <Text span c="dimmed">Инициатор: </Text>
                        {v.createdBy.fullName}
                      </Text>
                      {v.subjectOrganization && (
                        <Text size="sm">
                          <Text span c="dimmed">Кандидат: </Text>
                          <Anchor component={Link} to={`/organizations/${v.subjectOrganization.id}`}>
                            {v.subjectOrganization.name}
                          </Anchor>
                        </Text>
                      )}
                      {v.reminders.length > 0 && (
                        <Text size="sm">
                          <Text span c="dimmed">Напоминания: </Text>
                          за {v.reminders.map((r) => `${r.beforeHours} ч`).join(', ')} до окончания
                        </Text>
                      )}
                    </Stack>
                  </Card>
                </Stack>
              </Grid.Col>
            </Grid>
            {v.status !== 'DRAFT' && <NamedTable vote={v} />}
            <ExtendModal key={v.endsAt} vote={v} opened={extendOpen} onClose={() => setExtendOpen(false)} />
          </>
        )}
      </QueryState>
    </Stack>
  );
}

import { ActionIcon, Alert, Anchor, Badge, Button, Card, FileButton, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { IconDownload, IconEdit, IconEyeOff, IconFileText, IconPaperclip, IconSend, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../api/client';
import type { ProtocolDetail } from '../../api/types';
import { notifyError, notifyOk, PageHeader, QueryState } from '../../components/common';
import { fmtDate, fmtDateTime, VOTE_STATUS } from '../../labels';
import { EventTypeBadge, ProtocolStatusBadge } from './EventShared';

export function ProtocolPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['protocol', id], queryFn: () => api<ProtocolDetail>(`/protocols/${id}`) });
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const p = q.data;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['protocol', id] });
    await qc.invalidateQueries({ queryKey: ['protocols'] });
    await qc.invalidateQueries({ queryKey: ['event'] });
  };
  const act = async () => {
    setBusy(true);
    try {
      if (confirm === 'delete') {
        await api(`/protocols/${id}`, { method: 'DELETE' });
        await qc.invalidateQueries({ queryKey: ['protocols'] });
        notifyOk('Черновик удалён');
        navigate(p?.event ? `/events/${p.event.id}` : '/events?tab=protocols');
        return;
      }
      await api(`/protocols/${id}/${confirm}`, { method: 'POST' });
      await refresh();
      notifyOk(confirm === 'publish' ? 'Протокол опубликован, участники уведомлены' : 'Протокол снят с публикации');
      setConfirm(null);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/protocols/${id}/files`, { method: 'POST', body: fd });
      await refresh();
      notifyOk('Файл приложен');
    } catch (e) {
      notifyError(e);
    }
  };
  const removeFile = async (fileId: string) => {
    try {
      await api(`/protocols/${id}/files/${fileId}`, { method: 'DELETE' });
      await refresh();
    } catch (e) {
      notifyError(e);
    }
  };

  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      {p && (
        <>
          <Anchor component={Link} to={p.event ? `/events/${p.event.id}` : '/events?tab=protocols'} size="sm">
            ← {p.event ? p.event.title : 'Все протоколы'}
          </Anchor>
          <PageHeader
            title={`${p.title}${p.number ? ` № ${p.number}` : ''}`}
            description={
              <Group gap={6} mt={4}>
                <ProtocolStatusBadge status={p.status} />
                {p.event && <EventTypeBadge type={p.event.type} />}
                {p.workingGroup && <Badge variant="outline" color="grape" size="sm">{p.workingGroup.name}</Badge>}
                {p.visibleToPartners && <Badge variant="light" color="gray" size="sm">виден партнёрам</Badge>}
              </Group>
            }
            actions={
              <>
                <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => downloadFile(`/protocols/${p.id}/pdf`, `Протокол ${p.number ?? ''}.pdf`).catch(notifyError)}>
                  PDF
                </Button>
                {p.canManage && p.status === 'DRAFT' && (
                  <>
                    <Button variant="light" leftSection={<IconEdit size={16} />} component={Link} to={`/protocols/${p.id}/edit`}>
                      Редактировать
                    </Button>
                    <Button leftSection={<IconSend size={16} />} onClick={() => setConfirm('publish')}>
                      Опубликовать
                    </Button>
                    <ActionIcon variant="subtle" color="red" size="lg" title="Удалить черновик" onClick={() => setConfirm('delete')}>
                      <IconTrash size={18} />
                    </ActionIcon>
                  </>
                )}
                {p.canManage && p.status === 'PUBLISHED' && (
                  <Button variant="subtle" color="gray" leftSection={<IconEyeOff size={16} />} onClick={() => setConfirm('unpublish')}>
                    Снять с публикации
                  </Button>
                )}
              </>
            }
          />
          {p.status === 'DRAFT' && (
            <Alert color="gray" mb="md">
              Черновик виден только секретариату{p.workingGroup ? ' и руководителю рабочей группы' : ''}. Участники получат уведомление после публикации.
            </Alert>
          )}
          <Stack>
            <Card withBorder padding="lg">
              <Stack gap={4}>
                <Text size="sm">
                  <b>Дата заседания:</b> {fmtDateTime(p.heldAt)} МСК
                </Text>
                {p.event?.location && (
                  <Text size="sm">
                    <b>Место:</b> {p.event.location}
                  </Text>
                )}
                {p.attendance && (
                  <Text size="sm">
                    <b>Присутствовали организации ({p.attendance.present.length}; приглашено {p.attendance.invited}):</b> {p.attendance.present.join(', ') || '—'}
                  </Text>
                )}
                {p.author && (
                  <Text size="sm" c="dimmed">
                    Секретарь заседания: {p.author.fullName}
                    {p.publishedAt ? ` · опубликован ${fmtDate(p.publishedAt)}` : ''}
                  </Text>
                )}
              </Stack>
            </Card>
            {p.items.map((it, i) => (
              <Card key={it.id ?? i} withBorder padding="lg">
                <Title order={5} mb="xs">
                  {i + 1}. {it.agendaText}
                </Title>
                {it.discussion && (
                  <Text size="sm" mb="xs" style={{ whiteSpace: 'pre-line' }}>
                    <Text span fw={600}>Слушали: </Text>
                    {it.discussion}
                  </Text>
                )}
                {it.decision && (
                  <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
                    <Text span fw={600}>Решили: </Text>
                    {it.decision}
                  </Text>
                )}
                {it.vote && (
                  <Group gap={6} mt="xs">
                    <Text size="sm" c="dimmed">Голосование:</Text>
                    <Anchor component={Link} to={`/votes/${it.vote.id}`} size="sm">
                      № {it.vote.number}. {it.vote.title}
                    </Anchor>
                    <Badge size="xs" variant="light" color={VOTE_STATUS[it.vote.status].color}>
                      {VOTE_STATUS[it.vote.status].label}
                    </Badge>
                    {it.vote.outcome && <Text size="sm">— {it.vote.outcome.join('; ')}</Text>}
                  </Group>
                )}
              </Card>
            ))}
            {(p.attachments.length > 0 || p.canManage) && (
              <Card withBorder padding="lg">
                <Group justify="space-between" mb="sm">
                  <Title order={5}>Приложения</Title>
                  {p.canManage && (
                    <FileButton onChange={upload}>
                      {(props) => (
                        <Button {...props} size="xs" variant="light" leftSection={<IconPaperclip size={14} />}>
                          Приложить файл
                        </Button>
                      )}
                    </FileButton>
                  )}
                </Group>
                <Stack gap={6}>
                  {p.attachments.map((f) => (
                    <Group key={f.id} justify="space-between" wrap="nowrap">
                      <Anchor size="sm" onClick={() => downloadFile(`/protocols/${p.id}/files/${f.id}`, f.originalName).catch(notifyError)}>
                        <Group gap={6} wrap="nowrap">
                          <IconFileText size={16} /> {f.originalName}
                        </Group>
                      </Anchor>
                      {p.canManage && (
                        <ActionIcon variant="subtle" color="red" onClick={() => removeFile(f.id)} title="Удалить файл">
                          <IconTrash size={16} />
                        </ActionIcon>
                      )}
                    </Group>
                  ))}
                  {!p.attachments.length && (
                    <Text size="sm" c="dimmed">
                      Файлов нет. Можно приложить подписанный скан, презентации, проекты документов.
                    </Text>
                  )}
                </Stack>
              </Card>
            )}
          </Stack>
          <Modal
            opened={!!confirm}
            onClose={() => setConfirm(null)}
            title={confirm === 'publish' ? 'Опубликовать протокол?' : confirm === 'unpublish' ? 'Снять с публикации?' : 'Удалить черновик?'}
          >
            <Text size="sm" mb="md">
              {confirm === 'publish'
                ? 'Протокол станет доступен членам Альянса, участники получат уведомление. После публикации текст нельзя изменить — только снять с публикации.'
                : confirm === 'unpublish'
                  ? 'Протокол вернётся в черновики и перестанет быть виден участникам.'
                  : 'Черновик будет удалён без возможности восстановления.'}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirm(null)}>
                Отмена
              </Button>
              <Button color={confirm === 'delete' ? 'red' : undefined} loading={busy} onClick={act}>
                {confirm === 'publish' ? 'Опубликовать' : confirm === 'unpublish' ? 'Снять' : 'Удалить'}
              </Button>
            </Group>
          </Modal>
        </>
      )}
    </QueryState>
  );
}

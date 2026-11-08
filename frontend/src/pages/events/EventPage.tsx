import { Alert, Anchor, Button, Card, Grid, Group, Modal, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core';
import { IconCalendarDown, IconEdit, IconFilePlus, IconMapPin, IconUsers, IconVideo, IconX } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadFile } from '../../api/client';
import type { EventDetail, EventParticipant, PresenceStatus, RegistrationStatus } from '../../api/types';
import { notifyError, notifyOk, PageHeader, QueryState, DemoBadge } from '../../components/common';
import { EVENT_FORMAT, fmtDateTime, fmtTime, PRESENCE } from '../../labels';
import { EventFormModal, EventStatusBadge, EventTypeBadge, ProtocolStatusBadge, RegistrationBadge } from './EventShared';

function Registration({ e }: { e: EventDetail }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const current = e.my?.registration;
  const register = async (registration: RegistrationStatus) => {
    setBusy(registration);
    try {
      await api(`/events/${e.id}/registration`, { method: 'POST', body: { registration } });
      await qc.invalidateQueries({ queryKey: ['event', e.id] });
      await qc.invalidateQueries({ queryKey: ['events'] });
      notifyOk('Ответ сохранён');
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  };
  const options: { value: RegistrationStatus; label: string; show: boolean }[] = [
    { value: 'CONFIRMED_OFFLINE', label: 'Буду очно', show: e.format !== 'ONLINE' },
    { value: 'CONFIRMED_ONLINE', label: 'Буду онлайн', show: e.format !== 'OFFLINE' },
    { value: 'DECLINED', label: 'Не смогу', show: true },
  ];
  return (
    <Card withBorder padding="lg">
      <Title order={5} mb="sm">
        Ваше участие
      </Title>
      {current && current !== 'INVITED' && (
        <Group gap="xs" mb="sm">
          <Text size="sm">Ваш ответ:</Text>
          <RegistrationBadge value={current} />
        </Group>
      )}
      {e.canRegister ? (
        <>
          <Group gap="xs">
            {options
              .filter((o) => o.show)
              .map((o) => (
                <Button
                  key={o.value}
                  size="sm"
                  variant={current === o.value ? 'filled' : 'light'}
                  color={o.value === 'DECLINED' ? 'red' : undefined}
                  loading={busy === o.value}
                  onClick={() => register(o.value)}
                >
                  {o.label}
                </Button>
              ))}
          </Group>
          {e.registrationDeadline && (
            <Text size="xs" c="dimmed" mt="xs">
              Ответ можно изменить до {fmtDateTime(e.registrationDeadline)} МСК
            </Text>
          )}
        </>
      ) : (
        <Text size="sm" c="dimmed">
          {e.status === 'CANCELLED' ? 'Мероприятие отменено.' : new Date(e.startsAt) < new Date() ? 'Мероприятие уже началось или прошло.' : 'Регистрация закрыта.'}
        </Text>
      )}
      {e.my && e.my.presence !== 'UNKNOWN' && (
        <Text size="sm" mt="sm">
          Отметка организатора: <b>{PRESENCE[e.my.presence]}</b>
        </Text>
      )}
    </Card>
  );
}

/** Таблица приглашённых с отметкой присутствия (секретарь, администратор). */
function Attendance({ e }: { e: EventDetail }) {
  const qc = useQueryClient();
  const started = new Date(e.startsAt) <= new Date();
  const [marks, setMarks] = useState<Record<string, PresenceStatus>>({});
  const [busy, setBusy] = useState(false);
  const rows = e.participants as (EventParticipant & { userId: string; presence: PresenceStatus })[];
  const changed = Object.keys(marks).length;
  const presenceOptions = [
    ...(e.format !== 'ONLINE' ? [{ value: 'PRESENT_OFFLINE', label: 'Очно' }] : []),
    ...(e.format !== 'OFFLINE' ? [{ value: 'PRESENT_ONLINE', label: 'Онлайн' }] : []),
    { value: 'ABSENT', label: 'Нет' },
  ];
  const save = async () => {
    setBusy(true);
    try {
      await api(`/events/${e.id}/attendance`, { method: 'PUT', body: { items: Object.entries(marks).map(([userId, presence]) => ({ userId, presence })) } });
      setMarks({});
      await qc.invalidateQueries({ queryKey: ['event', e.id] });
      await qc.invalidateQueries({ queryKey: ['events'] });
      notifyOk('Присутствие отмечено');
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  const markAllConfirmed = () => {
    const next: Record<string, PresenceStatus> = {};
    for (const r of rows) {
      if (r.registration === 'CONFIRMED_OFFLINE') next[r.userId] = 'PRESENT_OFFLINE';
      else if (r.registration === 'CONFIRMED_ONLINE') next[r.userId] = 'PRESENT_ONLINE';
    }
    setMarks(next);
  };
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={5}>Приглашённые и присутствие</Title>
        {started && e.status !== 'CANCELLED' && (
          <Group gap="xs">
            <Button size="xs" variant="subtle" onClick={markAllConfirmed}>
              Отметить подтвердивших
            </Button>
            <Button size="xs" disabled={!changed} loading={busy} onClick={save}>
              Сохранить{changed ? ` (${changed})` : ''}
            </Button>
          </Group>
        )}
      </Group>
      {!started && (
        <Text size="sm" c="dimmed" mb="sm">
          Присутствие можно отметить после начала мероприятия.
        </Text>
      )}
      <Table.ScrollContainer minWidth={620}>
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Участник</Table.Th>
              <Table.Th>Организация</Table.Th>
              <Table.Th>Ответ</Table.Th>
              <Table.Th>Присутствие</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => {
              const value = marks[r.userId] ?? r.presence;
              const org = r.organization && typeof r.organization === 'object' ? r.organization : null;
              return (
                <Table.Tr key={r.userId}>
                  <Table.Td>
                    <Text size="sm">{r.fullName}</Text>
                    {!r.invited && (
                      <Text size="xs" c="dimmed">
                        не из списка приглашённых
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {org ? (
                      <Anchor component={Link} to={`/organizations/${org.id}`} size="sm">
                        {org.name}
                      </Anchor>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>
                    <RegistrationBadge value={r.registration} />
                  </Table.Td>
                  <Table.Td>
                    {started && e.status !== 'CANCELLED' ? (
                      <SegmentedControl
                        size="xs"
                        value={value === 'UNKNOWN' ? '' : value}
                        onChange={(v) => setMarks((m) => ({ ...m, [r.userId]: v as PresenceStatus }))}
                        data={presenceOptions}
                        color={value === 'ABSENT' ? 'red' : 'teal'}
                      />
                    ) : (
                      <Text size="sm" c="dimmed">
                        {PRESENCE[r.presence]}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Card>
  );
}

function Confirmed({ e }: { e: EventDetail }) {
  if (!e.participants.length) return null;
  return (
    <Card withBorder padding="lg">
      <Title order={5} mb="sm">
        Подтвердили участие
      </Title>
      <Stack gap={4}>
        {e.participants.map((p, i) => (
          <Group key={i} justify="space-between" wrap="nowrap">
            <Text size="sm">
              {p.fullName}
              {p.organization ? <Text span c="dimmed"> · {typeof p.organization === 'string' ? p.organization : p.organization.name}</Text> : null}
            </Text>
            <RegistrationBadge value={p.registration} />
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

export function EventPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['event', id], queryFn: () => api<EventDetail>(`/events/${id}`) });
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const e = q.data;

  const cancel = async () => {
    try {
      await api(`/events/${id}/cancel`, { method: 'POST' });
      setCancelling(false);
      await qc.invalidateQueries({ queryKey: ['event', id] });
      await qc.invalidateQueries({ queryKey: ['events'] });
      notifyOk('Мероприятие отменено, участники уведомлены');
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      {e && (
        <>
          <Anchor component={Link} to="/events" size="sm">
            ← Все мероприятия
          </Anchor>
          <PageHeader
            title={e.title}
            description={
              <Group gap={6} mt={4}>
                <EventTypeBadge type={e.type} audience={e.audience} />
                <DemoBadge show={e.isDemo} />
                <EventStatusBadge status={e.status} />
                {e.workingGroup && <Text size="sm">{e.workingGroup.name}</Text>}
              </Group>
            }
            actions={
              <>
                <Button variant="default" leftSection={<IconCalendarDown size={16} />} onClick={() => downloadFile(`/events/${e.id}/ics`, 'event.ics').catch(notifyError)}>
                  В календарь (.ics)
                </Button>
                {e.canManage && e.status !== 'CANCELLED' && (
                  <>
                    <Button variant="light" leftSection={<IconEdit size={16} />} onClick={() => setEditing(true)}>
                      Изменить
                    </Button>
                    {e.status === 'PLANNED' && (
                      <Button variant="subtle" color="red" leftSection={<IconX size={16} />} onClick={() => setCancelling(true)}>
                        Отменить
                      </Button>
                    )}
                  </>
                )}
              </>
            }
          />
          {e.status === 'CANCELLED' && (
            <Alert color="red" mb="md">
              Мероприятие отменено.
            </Alert>
          )}
          <Grid>
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Stack>
                <Card withBorder padding="lg">
                  <Stack gap="xs">
                    <Text fw={600} size="lg">
                      {fmtDateTime(e.startsAt)}
                      {e.endsAt ? `–${fmtTime(e.endsAt)}` : ''} МСК
                    </Text>
                    <Text size="sm">Формат: {EVENT_FORMAT[e.format]}</Text>
                    {e.location && (
                      <Group gap={6} wrap="nowrap">
                        <IconMapPin size={16} />
                        <Text size="sm">{e.location}</Text>
                      </Group>
                    )}
                    {e.onlineUrl && (
                      <Group gap={6} wrap="nowrap">
                        <IconVideo size={16} />
                        <Anchor href={e.onlineUrl} target="_blank" rel="noopener noreferrer" size="sm">
                          {e.onlineUrl}
                        </Anchor>
                      </Group>
                    )}
                    {e.description && (
                      <Text size="sm" style={{ whiteSpace: 'pre-line' }} mt="xs">
                        {e.description}
                      </Text>
                    )}
                  </Stack>
                </Card>
                {e.canManage ? <Attendance e={e} /> : <Confirmed e={e} />}
              </Stack>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack>
                {(e.canRegister || e.my) && <Registration e={e} />}
                <Card withBorder padding="lg">
                  <Group gap={6} mb="sm">
                    <IconUsers size={18} />
                    <Title order={5}>Участие</Title>
                  </Group>
                  <Stack gap={4}>
                    <Text size="sm">Приглашено организаций: {e.summary.invitedOrganizations}</Text>
                    <Text size="sm">
                      Подтвердили: очно {e.summary.confirmedOffline}, онлайн {e.summary.confirmedOnline}
                    </Text>
                    <Text size="sm">Отказались: {e.summary.declined}</Text>
                    {e.status === 'HELD' && (
                      <Text size="sm" fw={500}>
                        Присутствовало: {e.summary.presentPeople} чел. из {e.summary.presentOrganizations} организаций
                      </Text>
                    )}
                  </Stack>
                </Card>
                <Card withBorder padding="lg">
                  <Group justify="space-between" mb="sm">
                    <Title order={5}>Протоколы</Title>
                    {e.canManage && (
                      <Button size="xs" variant="light" leftSection={<IconFilePlus size={14} />} component={Link} to={`/protocols/new?eventId=${e.id}`}>
                        Создать протокол
                      </Button>
                    )}
                  </Group>
                  {e.protocols.length ? (
                    <Stack gap={6}>
                      {e.protocols.map((p) => (
                        <Group key={p.id} justify="space-between" wrap="nowrap">
                          <Anchor component={Link} to={`/protocols/${p.id}`} size="sm">
                            {p.number ? `№ ${p.number}. ` : ''}
                            {p.title}
                          </Anchor>
                          <ProtocolStatusBadge status={p.status} />
                        </Group>
                      ))}
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Протокол ещё не опубликован.
                    </Text>
                  )}
                </Card>
                {e.createdBy && (
                  <Text size="xs" c="dimmed">
                    Организатор: {e.createdBy.fullName}
                  </Text>
                )}
              </Stack>
            </Grid.Col>
          </Grid>
          {editing && <EventFormModal opened event={e} onClose={() => setEditing(false)} />}
          <Modal opened={cancelling} onClose={() => setCancelling(false)} title="Отменить мероприятие?">
            <Text size="sm" mb="md">
              Подтвердившие участие получат уведомление об отмене. Отмену нельзя вернуть.
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCancelling(false)}>
                Не отменять
              </Button>
              <Button color="red" onClick={cancel}>
                Отменить мероприятие
              </Button>
            </Group>
          </Modal>
        </>
      )}
    </QueryState>
  );
}

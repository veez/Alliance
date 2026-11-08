import { Badge, Button, Checkbox, Group, Modal, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useWorkingGroupsBrief } from '../../api/hooks';
import type { EventAudience, EventBase, EventFormat, EventStatus, EventType, ProtocolStatus, RegistrationStatus } from '../../api/types';
import { notifyError, notifyOk } from '../../components/common';
import { EVENT_AUDIENCE, EVENT_FORMAT, EVENT_STATUS, EVENT_TYPE, PROTOCOL_STATUS, REGISTRATION } from '../../labels';

export const EventTypeBadge = ({ type, audience }: { type: EventType; audience?: EventAudience }) => (
  <Badge variant="light" color={audience === 'BOARD' ? 'red' : audience === 'CANDIDATES' ? 'yellow' : EVENT_TYPE[type].color} size="sm">
    {audience === 'BOARD' ? 'Заседание правления' : audience === 'CANDIDATES' ? 'Для кандидатов' : EVENT_TYPE[type].label}
  </Badge>
);
export const EventStatusBadge = ({ status }: { status: EventStatus }) =>
  status === 'PLANNED' ? null : (
    <Badge variant="light" color={EVENT_STATUS[status].color} size="sm">
      {EVENT_STATUS[status].label}
    </Badge>
  );
export const RegistrationBadge = ({ value }: { value: RegistrationStatus }) => (
  <Badge variant="light" color={REGISTRATION[value].color} size="sm">
    {REGISTRATION[value].label}
  </Badge>
);
export const ProtocolStatusBadge = ({ status }: { status: ProtocolStatus }) => (
  <Badge variant="light" color={PROTOCOL_STATUS[status].color} size="sm">
    {PROTOCOL_STATUS[status].label}
  </Badge>
);

const opts = <T extends string>(r: Record<T, string | { label: string }>) =>
  (Object.keys(r) as T[]).map((k) => ({ value: k, label: typeof r[k] === 'string' ? (r[k] as string) : (r[k] as { label: string }).label }));

interface FormValues {
  title: string;
  description: string;
  type: EventType;
  audience: EventAudience;
  format: EventFormat;
  location: string;
  onlineUrl: string;
  startsAt: Date | null;
  endsAt: Date | null;
  registrationDeadline: Date | null;
  workingGroupId: string | null;
  visibleToPartners: boolean;
  notify: boolean;
}

/** Создание и изменение мероприятия (секретарь, администратор). */
export function EventFormModal({ opened, onClose, event, presetGroupId }: { opened: boolean; onClose: () => void; event?: EventBase; presetGroupId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const groups = useWorkingGroupsBrief();
  const [busy, setBusy] = useState(false);
  const d = (v?: string | null) => (v ? new Date(v) : null);
  const form = useForm<FormValues>({
    initialValues: {
      title: event?.title ?? '',
      description: event?.description ?? '',
      type: event?.type ?? (presetGroupId ? 'WORKING_GROUP_MEETING' : 'GENERAL_MEETING'),
      audience: event?.audience ?? (presetGroupId ? 'BOARD' : 'ALL_MEMBERS'),
      format: event?.format ?? 'ONLINE',
      location: event?.location ?? '',
      onlineUrl: event?.onlineUrl ?? '',
      startsAt: d(event?.startsAt),
      endsAt: d(event?.endsAt),
      registrationDeadline: d(event?.registrationDeadline),
      workingGroupId: event?.workingGroupId ?? presetGroupId ?? null,
      visibleToPartners: event?.visibleToPartners ?? false,
      notify: true,
    },
    validate: {
      title: (v) => (v.trim().length < 3 ? 'Укажите название' : null),
      startsAt: (v) => (v ? null : 'Укажите дату и время начала'),
      endsAt: (v, all) => (v && all.startsAt && v <= all.startsAt ? 'Окончание должно быть позже начала' : null),
      location: (v, all) => (all.format !== 'ONLINE' && !v.trim() ? 'Укажите место проведения' : null),
      workingGroupId: (v, all) => (all.type === 'WORKING_GROUP_MEETING' && all.audience !== 'BOARD' && !v ? 'Выберите рабочую группу' : null),
    },
  });

  const submit = form.onSubmit(async (v) => {
    setBusy(true);
    const body = {
      title: v.title.trim(),
      description: v.description.trim() || undefined,
      type: v.audience === 'BOARD' ? ('WORKING_GROUP_MEETING' as const) : v.type,
      audience: v.type === 'WORKING_GROUP_MEETING' && v.audience !== 'BOARD' ? ('ALL_MEMBERS' as const) : v.audience,
      format: v.format,
      location: v.format === 'ONLINE' ? undefined : v.location.trim() || undefined,
      onlineUrl: v.format === 'OFFLINE' ? undefined : v.onlineUrl.trim() || undefined,
      startsAt: v.startsAt!.toISOString(),
      endsAt: v.endsAt?.toISOString(),
      registrationDeadline: v.registrationDeadline?.toISOString(),
      workingGroupId: v.audience !== 'BOARD' && v.type === 'WORKING_GROUP_MEETING' ? v.workingGroupId : undefined,
      visibleToPartners: v.audience === 'ALL_MEMBERS' && v.visibleToPartners,
    };
    try {
      if (event) {
        await api(`/events/${event.id}`, { method: 'PATCH', body });
        notifyOk('Мероприятие сохранено');
      } else {
        const created = await api<{ id: string }>('/events', { method: 'POST', body: { ...body, notify: v.notify } });
        notifyOk(v.notify ? 'Мероприятие создано, приглашения разосланы' : 'Мероприятие создано');
        navigate(`/events/${created.id}`);
      }
      await qc.invalidateQueries({ queryKey: ['events'] });
      await qc.invalidateQueries({ queryKey: ['event'] });
      onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  });

  return (
    <Modal opened={opened} onClose={onClose} title={event ? 'Изменить мероприятие' : presetGroupId ? 'Новое заседание' : 'Новое мероприятие'} size="lg">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label="Название" withAsterisk {...form.getInputProps('title')} />
          {!presetGroupId && (form.values.type !== 'WORKING_GROUP_MEETING' || form.values.audience === 'BOARD') && (
            <Select
              label="Кому рассылать"
              description="Приглашение и напоминания получат только представители этой группы"
              data={opts(EVENT_AUDIENCE)}
              allowDeselect={false}
              {...form.getInputProps('audience')}
            />
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {form.values.audience !== 'BOARD' && <Select label="Тип" data={opts(EVENT_TYPE)} allowDeselect={false} {...form.getInputProps('type')} />}
            <Select label="Формат" data={opts(EVENT_FORMAT)} allowDeselect={false} {...form.getInputProps('format')} />
          </SimpleGrid>
          {form.values.audience !== 'BOARD' && form.values.type === 'WORKING_GROUP_MEETING' && (
            <Select label="Рабочая группа" withAsterisk data={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))} {...form.getInputProps('workingGroupId')} />
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <DateTimePicker label="Начало (МСК)" withAsterisk valueFormat="DD.MM.YYYY HH:mm" {...form.getInputProps('startsAt')} />
            <DateTimePicker label="Окончание (МСК)" clearable valueFormat="DD.MM.YYYY HH:mm" {...form.getInputProps('endsAt')} />
          </SimpleGrid>
          {form.values.format !== 'ONLINE' && <TextInput label="Место проведения" withAsterisk {...form.getInputProps('location')} />}
          {form.values.format !== 'OFFLINE' && <TextInput label="Ссылка на онлайн-подключение" placeholder="https://…" {...form.getInputProps('onlineUrl')} />}
          <DateTimePicker
            label="Регистрация до (МСК)"
            description="Если не указано — до начала мероприятия"
            clearable
            valueFormat="DD.MM.YYYY HH:mm"
            {...form.getInputProps('registrationDeadline')}
          />
          <Textarea label="Описание и повестка" autosize minRows={3} maxRows={10} {...form.getInputProps('description')} />
          {!presetGroupId && form.values.audience === 'ALL_MEMBERS' && <Checkbox label="Видно партнёрам Альянса" {...form.getInputProps('visibleToPartners', { type: 'checkbox' })} />}
          {!event && <Checkbox label={`Разослать приглашения (в портале и по почте): ${form.values.type === 'WORKING_GROUP_MEETING' && form.values.audience !== 'BOARD' ? 'участникам рабочей группы' : EVENT_AUDIENCE[form.values.audience].toLowerCase()}`} {...form.getInputProps('notify', { type: 'checkbox' })} />}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={busy}>
              {event ? 'Сохранить' : 'Создать'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

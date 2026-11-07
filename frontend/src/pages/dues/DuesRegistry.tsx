import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Group,
  Modal,
  NumberInput,
  Pagination,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconBellRinging, IconPaperclip, IconPlus, IconSearch, IconSettings, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api/client';
import type { DuesDetail, DuesRow, DuesSettings, DuesSummary, Page } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { notifyError, notifyOk, QueryState } from '../../components/common';
import { useRegionOptions } from '../../components/OrganizationForm';
import { DUES_STATUS, fmtDay, fmtRub } from '../../labels';
import { DocList, DuesStatusBadge } from './DuesShared';

const PAGE_SIZE = 50;
const toDay = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : '');

function SettingsModal({ year, current, opened, onClose }: { year: number; current: DuesSettings | null; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm({
    initialValues: {
      amount: current ? Number(current.amount) : 36000,
      dueDate: current ? new Date(current.dueDate) : new Date(year, 2, 31),
      graceDays: current?.graceDays ?? 0,
      votingRequiresPaid: current?.votingRequiresPaid ?? false,
      applyToExisting: false,
    },
  });
  const save = useMutation({
    mutationFn: (v: typeof form.values) => api<{ appliedToExisting: number }>(`/dues/settings/${year}`, { method: 'PUT', body: { ...v, dueDate: toDay(v.dueDate) } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['dues'] });
      notifyOk(r.appliedToExisting ? `Сохранено, обновлено начислений: ${r.appliedToExisting}` : 'Сохранено');
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened={opened} onClose={onClose} title={`Взнос за ${year} год`}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <NumberInput label="Сумма взноса, ₽" min={0} thousandSeparator=" " decimalScale={2} {...form.getInputProps('amount')} />
          <DateInput label="Срок оплаты" valueFormat="DD.MM.YYYY" {...form.getInputProps('dueDate')} />
          <NumberInput label="Льготный период, дней" description="Сколько дней после срока взнос ещё не считается просроченным" min={0} max={365} {...form.getInputProps('graceDays')} />
          <Switch
            label="Голосуют только организации с оплаченным взносом"
            description="Применяется ко всем новым голосованиям «все члены Альянса» в этом году"
            {...form.getInputProps('votingRequiresPaid', { type: 'checkbox' })}
          />
          {current && <Checkbox label="Применить сумму и срок к уже начисленным взносам (кроме освобождённых)" {...form.getInputProps('applyToExisting', { type: 'checkbox' })} />}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" loading={save.isPending}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function DuesDrawerBody({ id, onChanged }: { id: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('dues.manage');
  const detail = useQuery({ queryKey: ['dues', 'detail', id], queryFn: () => api<DuesDetail>(`/dues/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dues', 'detail', id] });
    onChanged();
  };
  const payForm = useForm({
    initialValues: { amount: 0 as number | string, paidAt: new Date() as Date | null, documentNumber: '' },
    validate: { amount: (v) => (Number(v) > 0 ? null : 'Укажите сумму'), paidAt: (v) => (v ? null : 'Укажите дату') },
  });
  const pay = useMutation({
    mutationFn: (v: typeof payForm.values) => api(`/dues/${id}/payments`, { method: 'POST', body: { amount: Number(v.amount), paidAt: toDay(v.paidAt), documentNumber: v.documentNumber || undefined } }),
    onSuccess: () => {
      payForm.reset();
      notifyOk('Платёж отмечен');
      refresh();
    },
    onError: notifyError,
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/dues/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      notifyOk('Сохранено');
      refresh();
    },
    onError: notifyError,
  });
  const [note, setNote] = useState<string | null>(null);

  return (
    <QueryState isLoading={detail.isLoading} error={detail.error}>
      {detail.data && (
        <Stack>
          <div>
            <Anchor component={Link} to={`/organizations/${detail.data.organization.id}`} fw={600}>
              {detail.data.organization.name}
            </Anchor>
            <Group gap="xs" mt={4}>
              <DuesStatusBadge status={detail.data.status} />
              <Text size="sm" c="dimmed">
                срок {fmtDay(detail.data.dueDate)}
              </Text>
            </Group>
          </div>
          <SimpleGrid cols={3}>
            <div>
              <Text size="xs" c="dimmed">Начислено</Text>
              <Text fw={600}>{fmtRub(detail.data.amountDue)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Оплачено</Text>
              <Text fw={600}>{fmtRub(detail.data.paid)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Долг</Text>
              <Text fw={600} c={detail.data.debt > 0 ? 'red' : 'teal'}>
                {detail.data.status === 'WAIVED' ? '—' : fmtRub(detail.data.debt)}
              </Text>
            </div>
          </SimpleGrid>

          <Title order={5}>Платежи</Title>
          {detail.data.payments.length ? (
            <Table verticalSpacing={4}>
              <Table.Tbody>
                {detail.data.payments.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtDay(p.paidAt)}</Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtRub(p.amount)}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {p.documentNumber ? `п/п № ${p.documentNumber}` : ''} {p.recordedBy ? `· ${p.recordedBy.fullName}` : ''}
                      </Text>
                    </Table.Td>
                    {manage && (
                      <Table.Td w={40}>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          aria-label="Удалить платёж"
                          onClick={() =>
                            modals.openConfirmModal({
                              title: 'Удалить платёж?',
                              children: <Text size="sm">Статус взноса будет пересчитан.</Text>,
                              labels: { confirm: 'Удалить', cancel: 'Отмена' },
                              confirmProps: { color: 'red' },
                              onConfirm: () => api(`/dues/${id}/payments/${p.id}`, { method: 'DELETE' }).then(refresh).catch(notifyError),
                            })
                          }
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm" c="dimmed">
              Платежей нет
            </Text>
          )}
          {manage && detail.data.status !== 'WAIVED' && detail.data.debt > 0 && (
            <Card withBorder padding="sm">
              <form onSubmit={payForm.onSubmit((v) => pay.mutate(v))}>
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Отметить платёж
                  </Text>
                  <Group grow align="flex-start">
                    <NumberInput label="Сумма, ₽" min={0} thousandSeparator=" " decimalScale={2} {...payForm.getInputProps('amount')} />
                    <DateInput label="Дата" valueFormat="DD.MM.YYYY" maxDate={new Date()} {...payForm.getInputProps('paidAt')} />
                  </Group>
                  <TextInput label="№ платёжного поручения" {...payForm.getInputProps('documentNumber')} />
                  <Group justify="space-between">
                    <Button variant="subtle" size="xs" onClick={() => payForm.setFieldValue('amount', detail.data.debt)}>
                      Вся сумма долга ({fmtRub(detail.data.debt)})
                    </Button>
                    <Button type="submit" size="xs" loading={pay.isPending}>
                      Добавить
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Card>
          )}

          <Title order={5}>Документы</Title>
          <DocList docs={detail.data.documents} basePath={`/dues/${id}`} canUpload={manage} canRemove={manage} docTypes={['PAYMENT_ORDER', 'ACT', 'OTHER']} onChanged={refresh} />

          {manage && (
            <>
              <Title order={5}>Примечание и освобождение</Title>
              <Textarea autosize minRows={2} value={note ?? detail.data.note ?? ''} onChange={(e) => setNote(e.currentTarget.value)} placeholder="Например: рассрочка до 1 июня" />
              <Group justify="space-between">
                <Button size="xs" variant="light" disabled={note === null} loading={patch.isPending} onClick={() => patch.mutate({ note: note || null })}>
                  Сохранить примечание
                </Button>
                {detail.data.status === 'WAIVED' ? (
                  <Button size="xs" variant="subtle" onClick={() => patch.mutate({ waived: false })}>
                    Отменить освобождение
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="grape"
                    onClick={() =>
                      modals.openConfirmModal({
                        title: 'Освободить от взноса?',
                        children: <Text size="sm">Взнос за {detail.data.year} год не будет считаться долгом. Укажите основание в примечании.</Text>,
                        labels: { confirm: 'Освободить', cancel: 'Отмена' },
                        onConfirm: () => patch.mutate({ waived: true }),
                      })
                    }
                  >
                    Освободить от взноса
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      )}
    </QueryState>
  );
}

export function DuesRegistry() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const manage = can('dues.manage');
  const regionOptions = useRegionOptions();
  const settingsList = useQuery({ queryKey: ['dues', 'settings'], queryFn: () => api<DuesSettings[]>('/dues/settings') });
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [status, setStatus] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const registry = useQuery({
    queryKey: ['dues', 'registry', year, status, region, debounced, page],
    queryFn: () =>
      api<Page<DuesRow> & { summary: DuesSummary; settings: DuesSettings | null }>(`/dues${qs({ year, status, regionCode: region, search: debounced, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const years = [...new Set([thisYear + 1, thisYear, ...(settingsList.data ?? []).map((s) => s.year)])].sort((a, b) => b - a);
  const s = registry.data?.summary;
  const refresh = () => qc.invalidateQueries({ queryKey: ['dues'] });

  const accrue = useMutation({
    mutationFn: () => api<{ created: number }>(`/dues/years/${year}/accrue`, { method: 'POST' }),
    onSuccess: (r) => {
      notifyOk(r.created ? `Начислено организаций: ${r.created}` : 'Все члены Альянса уже получили начисление');
      refresh();
    },
    onError: notifyError,
  });
  const remind = useMutation({
    mutationFn: () => api<{ sent: number; debtors: number; skipped: number }>(`/dues/years/${year}/remind`, { method: 'POST' }),
    onSuccess: (r) => notifyOk(`Напоминания отправлены: ${r.sent} из ${r.debtors}${r.skipped ? ` (остальным уже отправлено сегодня)` : ''}`),
    onError: notifyError,
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Select w={140} value={String(year)} onChange={(v) => v && (setYear(Number(v)), setPage(1))} data={years.map(String)} allowDeselect={false} aria-label="Год" />
        {manage && (
          <Group gap="xs">
            <Button variant="default" leftSection={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>
              Сумма и срок
            </Button>
            <Button variant="default" leftSection={<IconPlus size={16} />} disabled={!registry.data?.settings} loading={accrue.isPending} onClick={() => accrue.mutate()}>
              Начислить
            </Button>
            <Button
              leftSection={<IconBellRinging size={16} />}
              disabled={!s || s.counts.UNPAID + s.counts.PARTIAL + s.counts.OVERDUE === 0}
              loading={remind.isPending}
              onClick={() =>
                modals.openConfirmModal({
                  title: 'Напомнить должникам?',
                  children: <Text size="sm">Письмо получат пользователи организаций с долгом за {year} год и их сотрудники, отвечающие за взносы.</Text>,
                  labels: { confirm: 'Отправить', cancel: 'Отмена' },
                  onConfirm: () => remind.mutate(),
                })
              }
            >
              Напомнить должникам
            </Button>
          </Group>
        )}
      </Group>

      {registry.data && !registry.data.settings && (
        <Alert color="yellow" title={`Взнос за ${year} год не настроен`}>
          {manage ? 'Задайте сумму и срок оплаты, затем начислите взнос членам Альянса.' : 'Секретарь ещё не задал сумму взноса на этот год.'}
        </Alert>
      )}
      {s && s.notAccrued > 0 && registry.data?.settings && (
        <Alert color="blue">Членов Альянса без начисления за {year} год: {s.notAccrued}. {manage && 'Нажмите «Начислить».'}</Alert>
      )}

      {s && (
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">Начислено</Text>
            <Text size="xl" fw={700}>{fmtRub(s.totalDue)}</Text>
            <Text size="xs" c="dimmed">{s.accrued} организаций</Text>
          </Card>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">Оплачено</Text>
            <Text size="xl" fw={700} c="teal">{fmtRub(s.totalPaid)}</Text>
            <Progress value={s.totalDue ? Math.min(100, (s.totalPaid / s.totalDue) * 100) : 0} size="sm" mt={6} color="teal" />
          </Card>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">Задолженность</Text>
            <Text size="xl" fw={700} c={s.totalDebt > 0 ? 'red' : undefined}>{fmtRub(s.totalDebt)}</Text>
            <Text size="xs" c="dimmed">просрочено: {s.counts.OVERDUE}</Text>
          </Card>
          <Card withBorder padding="md">
            <Text size="xs" c="dimmed">Кто оплатил</Text>
            <Text size="xl" fw={700}>
              {s.counts.PAID} <Text span size="sm" c="dimmed">из {s.accrued - s.counts.WAIVED}</Text>
            </Text>
            <Text size="xs" c="dimmed">частично: {s.counts.PARTIAL} · освобождены: {s.counts.WAIVED}</Text>
          </Card>
        </SimpleGrid>
      )}

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <TextInput placeholder="Организация или ИНН" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => (setSearch(e.currentTarget.value), setPage(1))} />
        <Select
          placeholder="Статус"
          clearable
          value={status}
          onChange={(v) => (setStatus(v), setPage(1))}
          data={[{ value: 'DEBT', label: 'Все должники' }, ...Object.entries(DUES_STATUS).map(([value, x]) => ({ value, label: x.label }))]}
        />
        <Select placeholder="Регион" clearable searchable value={region} onChange={(v) => (setRegion(v), setPage(1))} data={regionOptions} />
      </SimpleGrid>

      <QueryState isLoading={registry.isLoading} error={registry.error}>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Организация</Table.Th>
                <Table.Th ta="right">Начислено</Table.Th>
                <Table.Th ta="right">Оплачено</Table.Th>
                <Table.Th ta="right">Долг</Table.Th>
                <Table.Th>Последний платёж</Table.Th>
                <Table.Th>Статус</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {registry.data?.items.map((r) => (
                <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {r.organization.shortName || r.organization.name}
                    </Text>
                    <Group gap={6}>
                      <Text size="xs" c="dimmed">
                        {r.organization.region?.name}
                      </Text>
                      {r.documentsCount > 0 && (
                        <Badge size="xs" variant="outline" color="gray" leftSection={<IconPaperclip size={10} />}>
                          {r.documentsCount}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{fmtRub(r.amountDue)}</Table.Td>
                  <Table.Td ta="right">{fmtRub(r.paid)}</Table.Td>
                  <Table.Td ta="right">
                    <Text size="sm" c={r.debt > 0 && r.status !== 'WAIVED' ? 'red' : 'dimmed'}>
                      {r.status === 'WAIVED' ? '—' : fmtRub(r.debt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>{fmtDay(r.lastPaidAt)}</Table.Td>
                  <Table.Td>
                    <DuesStatusBadge status={r.status} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {registry.data && !registry.data.items.length && <Text c="dimmed">Нет начислений по выбранным условиям.</Text>}
        {registry.data && registry.data.total > PAGE_SIZE && (
          <Group justify="center">
            <Pagination total={Math.ceil(registry.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </QueryState>

      <Drawer opened={!!openId} onClose={() => setOpenId(null)} title={`Взнос за ${year} год`} position="right" size="lg">
        {openId && <DuesDrawerBody id={openId} onChanged={refresh} />}
      </Drawer>
      {settingsOpen && <SettingsModal year={year} current={registry.data?.settings ?? null} opened onClose={() => setSettingsOpen(false)} />}
    </Stack>
  );
}

import { Anchor, Button, Card, Group, Modal, Select, SimpleGrid, Stack, Tabs, Text, Textarea, Timeline, Title, Alert, Checkbox } from '@mantine/core';
import { IconArrowLeft, IconExchange } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Organization, OrganizationNotes, OrganizationStatus, StatusHistoryEntry } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmployeesPanel } from '../components/EmployeesPanel';
import { OrganizationForm } from '../components/OrganizationForm';
import { OrgLogo } from '../components/OrgLogo';
import { OrgDuesHistory } from './dues/DuesShared';
import { notifyError, notifyOk, PageHeader, QueryState, Section, StatusBadge, DemoBadge } from '../components/common';
import { fmtDate, fmtDateTime, ORG_STATUS } from '../labels';

export function StatusHistory({ orgId }: { orgId: string }) {
  const history = useQuery({ queryKey: ['organization', orgId, 'history'], queryFn: () => api<StatusHistoryEntry[]>(`/organizations/${orgId}/status-history`) });
  return (
    <QueryState isLoading={history.isLoading} error={history.error}>
      <Timeline bulletSize={14} lineWidth={2}>
        {history.data?.map((h) => (
          <Timeline.Item key={h.id} title={ORG_STATUS[h.toStatus].label}>
            <Text size="xs" c="dimmed">
              {fmtDateTime(h.changedAt)}
              {h.changedBy ? ` · ${h.changedBy.fullName}` : ''}
              {h.fromStatus ? ` · было: ${ORG_STATUS[h.fromStatus].label}` : ''}
            </Text>
            {h.reason && <Text size="sm">{h.reason}</Text>}
          </Timeline.Item>
        ))}
      </Timeline>
    </QueryState>
  );
}

function OrgNotes({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [body, setBody] = useState('');
  const [decision, setDecision] = useState(false);
  const data = useQuery({ queryKey: ['organization', orgId, 'notes'], queryFn: () => api<OrganizationNotes>(`/organizations/${orgId}/notes`) });
  const add = useMutation({
    mutationFn: () => api(`/organizations/${orgId}/notes`, { method: 'POST', body: { body, kind: decision ? 'BOARD_DECISION' : 'COMMENT' } }),
    onSuccess: () => {
      setBody('');
      setDecision(false);
      qc.invalidateQueries({ queryKey: ['organization', orgId, 'notes'] });
    },
    onError: notifyError,
  });
  const canWrite = me?.systemRole === 'ADMIN' || me?.systemRole === 'SECRETARY';
  return (
    <QueryState isLoading={data.isLoading} error={data.error}>
      <Stack>
        {!!data.data?.rejectedMatches.length && (
          <Alert color="red" title="Похожие записи в списке отказов">
            {data.data.rejectedMatches.map((r) => (
              <div key={r.id}>
                <Anchor component={Link} to={`/organizations/${r.id}`} size="sm">
                  {r.shortName || r.name}
                </Anchor>{' '}
                — {ORG_STATUS[r.status].label}
              </div>
            ))}
          </Alert>
        )}
        {canWrite && (
          <Stack gap="xs">
            <Textarea placeholder="Новая запись" autosize minRows={2} value={body} onChange={(e) => setBody(e.currentTarget.value)} />
            <Group justify="space-between">
              <Checkbox label="Решение правления" checked={decision} onChange={(e) => setDecision(e.currentTarget.checked)} />
              <Button size="xs" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
                Добавить
              </Button>
            </Group>
          </Stack>
        )}
        {data.data?.notes.map((n) => (
          <div key={n.id}>
            <Text size="xs" c="dimmed">
              {fmtDateTime(n.createdAt)}
              {n.author ? ` · ${n.author.fullName}` : ' · импорт'}
              {n.kind === 'BOARD_DECISION' ? ' · решение правления' : ''}
            </Text>
            <Text size="sm" className="pre-wrap">
              {n.body}
            </Text>
          </div>
        ))}
        {data.data && !data.data.notes.length && (
          <Text size="sm" c="dimmed">
            Записей пока нет.
          </Text>
        )}
      </Stack>
    </QueryState>
  );
}

function ChangeStatusModal({ org, opened, onClose }: { org: Organization; opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<OrganizationStatus | null>(null);
  const [reason, setReason] = useState('');
  const change = useMutation({
    mutationFn: () => api(`/organizations/${org.id}/status`, { method: 'POST', body: { status, reason: reason || undefined } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', org.id] });
      qc.invalidateQueries({ queryKey: ['organizations'] });
      notifyOk('Статус изменён');
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened={opened} onClose={onClose} title="Смена статуса">
      <Stack>
        <Group gap="xs">
          <Text size="sm">Сейчас:</Text>
          <StatusBadge status={org.status} />
        </Group>
        <Select
          label="Новый статус"
          value={status}
          onChange={(v) => setStatus(v as OrganizationStatus)}
          data={(Object.keys(ORG_STATUS) as OrganizationStatus[]).filter((s) => s !== org.status).map((s) => ({ value: s, label: ORG_STATUS[s].label }))}
        />
        <Textarea label="Основание" placeholder="Например: решение общего собрания, протокол № 5 от 01.11.2026" value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!status} loading={change.isPending} onClick={() => change.mutate()}>
            Сменить статус
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" className="pre-wrap">
        {children}
      </Text>
    </div>
  );
}

export function OrganizationPage() {
  const { id = '' } = useParams();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const [statusOpen, setStatusOpen] = useState(false);
  const org = useQuery({ queryKey: ['organization', id], queryFn: () => api<Organization>(`/organizations/${id}`) });
  const isAdmin = can('orgs.manage');
  const isOwn = me?.organization?.id === id;

  return (
    <Stack>
      <Anchor component={Link} to="/organizations" size="sm">
        <Group gap={4}>
          <IconArrowLeft size={14} /> Все участники
        </Group>
      </Anchor>
      <QueryState isLoading={org.isLoading} error={org.error}>
        {org.data && (
          <>
            <PageHeader
              title={org.data.name}
              description={
                <Group gap="xs">
                  <DemoBadge show={org.data.isDemo} />
                  <StatusBadge status={org.data.status} />
                  <Text size="sm" c="dimmed">
                    {org.data.region?.name}
                    {org.data.city ? `, ${org.data.city}` : ''}
                  </Text>
                  {org.data.joinedAt && (
                    <Text size="sm" c="dimmed">
                      · в Альянсе с {fmtDate(org.data.joinedAt)}
                    </Text>
                  )}
                </Group>
              }
              actions={
                <>
                  {isAdmin && (
                    <Button variant="light" leftSection={<IconExchange size={16} />} onClick={() => setStatusOpen(true)}>
                      Сменить статус
                    </Button>
                  )}
                  <OrgLogo org={org.data} size={64} editable={isAdmin} />
                </>
              }
            />
            <Tabs defaultValue="card" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="card">Карточка</Tabs.Tab>
                {org.data.fullAccess && org.data.kind === 'ORGANIZATION' && <Tabs.Tab value="employees">Сотрудники</Tabs.Tab>}
                {org.data.fullAccess && <Tabs.Tab value="history">История статуса</Tabs.Tab>}
                {can('orgs.read_all') && <Tabs.Tab value="notes">Журнал секретаря</Tabs.Tab>}
                {(can('dues.read_all') || (isOwn && can('dues.read_own'))) && <Tabs.Tab value="dues">Взносы</Tabs.Tab>}
                {isAdmin && <Tabs.Tab value="edit">Редактировать</Tabs.Tab>}
              </Tabs.List>
              <Tabs.Panel value="card" pt="md">
                <SimpleGrid cols={{ base: 1, md: 2 }}>
                  <Card withBorder padding="lg">
                    <Title order={5} mb="sm">
                      О {org.data.kind === 'INDIVIDUAL' ? 'специалисте' : 'организации'}
                    </Title>
                    <Stack gap="sm">
                      <Field label="Другое название">{org.data.altName}</Field>
                      <Field label="Сферы деятельности">{org.data.activityAreas.join(', ')}</Field>
                      <Field label="Описание">{org.data.description}</Field>
                      <Field label="Сайт">
                        {org.data.website && (
                          <Anchor href={org.data.website} target="_blank" rel="noopener noreferrer">
                            {org.data.website}
                          </Anchor>
                        )}
                      </Field>
                    </Stack>
                  </Card>
                  <Card withBorder padding="lg">
                    <Title order={5} mb="sm">
                      Контакты
                    </Title>
                    {org.data.headName === undefined ? (
                      <Text size="sm" c="dimmed">
                        Контакты доступны членам Альянса.
                      </Text>
                    ) : (
                      <Stack gap="sm">
                        <Field label={org.data.headPosition || 'Руководитель'}>{org.data.headName}</Field>
                        <Field label="Email">{org.data.email}</Field>
                        <Field label="Телефон">{org.data.phone}</Field>
                      </Stack>
                    )}
                  </Card>
                  {org.data.fullAccess && org.data.kind === 'ORGANIZATION' && (
                    <Card withBorder padding="lg">
                      <Title order={5} mb="sm">
                        Реквизиты
                      </Title>
                      <Stack gap="sm">
                        <Field label="ИНН">{org.data.inn}</Field>
                        <Field label="ОГРН">{org.data.ogrn}</Field>
                        <Field label="КПП">{org.data.kpp}</Field>
                        <Field label="Юридический адрес">{org.data.legalAddress}</Field>
                        <Field label="Почтовый адрес">{org.data.postalAddress}</Field>
                      </Stack>
                    </Card>
                  )}
                  <Card withBorder padding="lg">
                    <Title order={5} mb="sm">
                      Рабочие группы
                    </Title>
                    <Text size="sm" c="dimmed">
                      Появится на этапе 5.
                    </Text>
                  </Card>
                </SimpleGrid>
              </Tabs.Panel>
              <Tabs.Panel value="employees" pt="md">
                <Section title="Сотрудники и зоны ответственности">
                  <EmployeesPanel orgId={id} editable={isAdmin || (isOwn && can('employees.manage_own'))} />
                </Section>
              </Tabs.Panel>
              <Tabs.Panel value="history" pt="md">
                <Section title="История статуса">
                  <StatusHistory orgId={id} />
                </Section>
              </Tabs.Panel>
              <Tabs.Panel value="notes" pt="md">
                <Section title="Журнал секретаря">
                  <OrgNotes orgId={id} />
                </Section>
              </Tabs.Panel>
              <Tabs.Panel value="dues" pt="md">
                <OrgDuesHistory orgId={id} />
              </Tabs.Panel>
              <Tabs.Panel value="edit" pt="md">
                <Section title="Редактирование">
                  <OrganizationForm
                    initial={org.data}
                    individual={org.data.kind === 'INDIVIDUAL'}
                    onSubmit={async (values) => {
                      try {
                        await api(`/organizations/${id}`, { method: 'PATCH', body: values as unknown as Record<string, unknown> });
                        await qc.invalidateQueries({ queryKey: ['organization', id] });
                        notifyOk('Изменения сохранены');
                      } catch (e) {
                        notifyError(e);
                        throw e;
                      }
                    }}
                  />
                </Section>
              </Tabs.Panel>
            </Tabs>
            <ChangeStatusModal org={org.data} opened={statusOpen} onClose={() => setStatusOpen(false)} />
          </>
        )}
      </QueryState>
    </Stack>
  );
}

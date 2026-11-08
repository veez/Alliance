import { Anchor, Button, Group, Modal, Pagination, SegmentedControl, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api/client';
import type { Organization, OrganizationStatus, Page } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { notifyError, notifyOk, PageHeader, QueryState, StatusBadge, DemoBadge } from '../components/common';
import { OrganizationForm, useRegionOptions } from '../components/OrganizationForm';
import { OrgLogo } from '../components/OrgLogo';
import { ORG_STATUS } from '../labels';

const PAGE_SIZE = 25;

function CreateOrganizationModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState<'ORGANIZATION' | 'INDIVIDUAL'>('ORGANIZATION');
  const [status, setStatus] = useState<OrganizationStatus>('CANDIDATE');
  return (
    <Modal opened={opened} onClose={onClose} title="Новый участник" size="xl">
      <OrganizationForm
        individual={kind === 'INDIVIDUAL'}
        submitLabel="Создать"
        extra={
          <Group grow align="flex-end">
            <SegmentedControl
              value={kind}
              onChange={(v) => setKind(v as typeof kind)}
              data={[
                { value: 'ORGANIZATION', label: 'Организация' },
                { value: 'INDIVIDUAL', label: 'Частный специалист' },
              ]}
            />
            <Select
              label="Статус"
              value={status}
              onChange={(v) => v && setStatus(v as OrganizationStatus)}
              data={(['CANDIDATE', 'MEMBER', 'PARTNER'] as const).map((s) => ({ value: s, label: ORG_STATUS[s].label }))}
            />
          </Group>
        }
        onSubmit={async (values) => {
          try {
            const org = await api<Organization>('/organizations', { method: 'POST', body: { ...values, kind, status } as unknown as Record<string, unknown> });
            await qc.invalidateQueries({ queryKey: ['organizations'] });
            notifyOk('Участник создан. Пригласите его представителя в разделе «Пользователи».');
            onClose();
            navigate(`/organizations/${org.id}`);
          } catch (e) {
            notifyError(e);
            throw e;
          }
        }}
      />
    </Modal>
  );
}

export function OrganizationsPage() {
  const { can } = useAuth();
  const regionOptions = useRegionOptions();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [status, setStatus] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const full = can('orgs.read_all');

  const list = useQuery({
    queryKey: ['organizations', debounced, status, region, page],
    queryFn: () => api<Page<Organization>>(`/organizations${qs({ search: debounced, status, regionCode: region, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const statuses: OrganizationStatus[] = full ? ['MEMBER', 'PARTNER', 'CANDIDATE', 'APPLICANT', 'SUSPENDED', 'EXITED', 'REJECTED', 'EXPELLED'] : ['MEMBER', 'CANDIDATE', 'PARTNER'];

  return (
    <Stack>
      <PageHeader
        title="Участники Альянса"
        description={list.data ? `Найдено: ${list.data.total}` : undefined}
        actions={
          can('orgs.manage') && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              Добавить участника
            </Button>
          )
        }
      />
      <Group grow preventGrowOverflow={false} wrap="wrap">
        <TextInput
          placeholder="Название, город"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setPage(1);
          }}
          miw={220}
        />
        <Select
          placeholder="Статус"
          clearable
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          data={statuses.map((s) => ({ value: s, label: ORG_STATUS[s].label }))}
          miw={180}
        />
        <Select
          placeholder="Регион"
          clearable
          searchable
          value={region}
          onChange={(v) => {
            setRegion(v);
            setPage(1);
          }}
          data={regionOptions}
          miw={220}
        />
      </Group>
      <QueryState isLoading={list.isLoading} error={list.error}>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Участник</Table.Th>
                <Table.Th>Регион</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Руководитель / контакты</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.data?.items.map((o) => (
                <Table.Tr key={o.id}>
                  <Table.Td>
                    <Group gap="sm" wrap="nowrap">
                      <OrgLogo org={o} size={36} />
                      <div>
                        <Anchor component={Link} to={`/organizations/${o.id}`} size="sm" fw={500}>
                          {o.shortName || o.name}
                        </Anchor>{' '}
                        <DemoBadge show={o.isDemo} />
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {o.kind === 'INDIVIDUAL' ? 'Частный специалист' : o.activityAreas.join(', ')}
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{o.region?.name}</Text>
                    <Text size="xs" c="dimmed">
                      {o.city}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge status={o.status} />
                  </Table.Td>
                  <Table.Td>
                    {o.headName !== undefined ? (
                      <>
                        <Text size="sm">{o.headName}</Text>
                        <Text size="xs" c="dimmed">
                          {[o.email, o.phone].filter(Boolean).join(' · ')}
                        </Text>
                      </>
                    ) : (
                      <Text size="xs" c="dimmed">
                        доступно членам Альянса
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {list.data && list.data.total > PAGE_SIZE && (
          <Group justify="center">
            <Pagination total={Math.ceil(list.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
          </Group>
        )}
      </QueryState>
      <CreateOrganizationModal opened={creating} onClose={() => setCreating(false)} />
    </Stack>
  );
}

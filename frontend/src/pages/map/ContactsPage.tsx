import { Anchor, Badge, Group, Pagination, Select, Stack, Table, Tabs, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconEyeOff, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api/client';
import { useRegions, useResponsibilityAreas, useWorkingGroupsBrief } from '../../api/hooks';
import type { OrganizationKind, Page } from '../../api/types';
import { PageHeader, QueryState } from '../../components/common';

interface OrgContact {
  id: string;
  name: string;
  shortName: string | null;
  kind: OrganizationKind;
  city: string | null;
  region: { code: string; name: string; district: string };
  website: string | null;
  activityAreas: string[];
  headName: string | null;
  headPosition: string | null;
  email: string | null;
  phone: string | null;
}
interface PersonContact {
  id: string;
  fullName: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  hiddenFromDirectory: boolean;
  organization: { id: string; name: string; city: string | null; region: { code: string; name: string } };
  responsibilities: { area: { code: string; name: string }; workingGroup: { id: string; name: string } | null }[];
}

const PAGE = 25;
const Contact = ({ email, phone }: { email: string | null; phone: string | null }) => (
  <Stack gap={0}>
    {phone && (
      <Anchor href={`tel:${phone}`} size="sm">
        {phone}
      </Anchor>
    )}
    {email && (
      <Anchor href={`mailto:${email}`} size="sm">
        {email}
      </Anchor>
    )}
    {!phone && !email && (
      <Text size="sm" c="dimmed">
        скрыты
      </Text>
    )}
  </Stack>
);

export function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'people';
  const regions = useRegions();
  const areas = useResponsibilityAreas();
  const groups = useWorkingGroupsBrief();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [district, setDistrict] = useState<string | null>(null);
  const [regionCode, setRegionCode] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState<string | null>(null);
  const [workingGroupId, setWorkingGroupId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const filters = { search: debounced || undefined, district, regionCode, page, pageSize: PAGE };

  const people = useQuery({
    queryKey: ['contacts', 'people', filters, areaCode, workingGroupId],
    queryFn: () => api<Page<PersonContact>>(`/contacts/people${qs({ ...filters, areaCode, workingGroupId })}`),
    enabled: tab === 'people',
  });
  const orgs = useQuery({
    queryKey: ['contacts', 'orgs', filters],
    queryFn: () => api<Page<OrgContact>>(`/contacts/organizations${qs(filters)}`),
    enabled: tab === 'orgs',
  });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const districts = [...new Set((regions.data ?? []).map((r) => r.federalDistrict))];
  const regionOptions = (regions.data ?? []).filter((r) => !district || r.federalDistrict === district).map((r) => ({ value: r.code, label: r.name }));
  const total = (tab === 'people' ? people.data?.total : orgs.data?.total) ?? 0;

  return (
    <>
      <PageHeader
        title="Контакты сообщества"
        description="Контакты организаций — членов Альянса и их сотрудников. Скрытые владельцем email и телефоны не показываются."
      />
      <Tabs
        value={tab}
        onChange={(v) => {
          setParams({ tab: v ?? 'people' });
          setPage(1);
        }}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="people">Сотрудники и ответственные</Tabs.Tab>
          <Tabs.Tab value="orgs">Организации</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Group gap="sm" mb="md">
        <TextInput placeholder="Имя, организация, должность" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => reset(setSearch)(e.currentTarget.value)} w={260} />
        <Select
          placeholder="Федеральный округ"
          clearable
          w={200}
          data={districts}
          value={district}
          onChange={(v) => {
            reset(setDistrict)(v);
            setRegionCode(null);
          }}
        />
        <Select placeholder="Регион" clearable searchable w={220} data={regionOptions} value={regionCode} onChange={reset(setRegionCode)} />
        {tab === 'people' && (
          <>
            <Select placeholder="Область ответственности" clearable w={230} data={(areas.data ?? []).map((a) => ({ value: a.code, label: a.name }))} value={areaCode} onChange={reset(setAreaCode)} />
            <Select placeholder="Рабочая группа" clearable w={230} data={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))} value={workingGroupId} onChange={reset(setWorkingGroupId)} />
          </>
        )}
      </Group>

      {tab === 'people' ? (
        <QueryState isLoading={people.isLoading} error={people.error}>
          {people.data?.items.length ? (
            <Table.ScrollContainer minWidth={800}>
              <Table verticalSpacing="sm" striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Сотрудник</Table.Th>
                    <Table.Th>Организация</Table.Th>
                    <Table.Th>Отвечает за</Table.Th>
                    <Table.Th w={220}>Контакты</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {people.data.items.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>
                            {p.fullName}
                          </Text>
                          {p.hiddenFromDirectory && (
                            <Badge size="xs" variant="light" color="gray" leftSection={<IconEyeOff size={10} />}>
                              скрыт для других
                            </Badge>
                          )}
                        </Group>
                        {p.position && (
                          <Text size="xs" c="dimmed">
                            {p.position}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Anchor component={Link} to={`/organizations/${p.organization.id}`} size="sm">
                          {p.organization.name}
                        </Anchor>
                        <Text size="xs" c="dimmed">
                          {p.organization.city ?? p.organization.region.name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {p.responsibilities.map((r, i) => (
                            <Badge key={i} size="sm" variant="light" color={r.workingGroup ? 'grape' : 'teal'} style={{ textTransform: 'none' }}>
                              {r.workingGroup ? r.workingGroup.name : r.area.name}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Contact email={p.email} phone={p.phone} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text c="dimmed">Никого не найдено.</Text>
          )}
        </QueryState>
      ) : (
        <QueryState isLoading={orgs.isLoading} error={orgs.error}>
          {orgs.data?.items.length ? (
            <Table.ScrollContainer minWidth={800}>
              <Table verticalSpacing="sm" striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Организация</Table.Th>
                    <Table.Th>Регион</Table.Th>
                    <Table.Th>Руководитель</Table.Th>
                    <Table.Th w={220}>Контакты</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {orgs.data.items.map((o) => (
                    <Table.Tr key={o.id}>
                      <Table.Td>
                        <Anchor component={Link} to={`/organizations/${o.id}`} size="sm" fw={500}>
                          {o.shortName || o.name}
                        </Anchor>
                        {o.activityAreas.length > 0 && (
                          <Text size="xs" c="dimmed">
                            {o.activityAreas.join(', ')}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{o.city ?? o.region.name}</Text>
                        <Text size="xs" c="dimmed">
                          {o.region.district} ФО
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{o.headName ?? '—'}</Text>
                        {o.headPosition && (
                          <Text size="xs" c="dimmed">
                            {o.headPosition}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Contact email={o.email} phone={o.phone} />
                        {o.website && (
                          <Anchor href={o.website} target="_blank" rel="noopener noreferrer" size="xs">
                            {o.website.replace(/^https?:\/\//, '')}
                          </Anchor>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text c="dimmed">Ничего не найдено.</Text>
          )}
        </QueryState>
      )}
      {total > PAGE && <Pagination mt="md" total={Math.ceil(total / PAGE)} value={page} onChange={setPage} />}
    </>
  );
}

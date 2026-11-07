import { Alert, Group, Stack, Tabs, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Organization } from '../api/types';
import { useAuth, useMe } from '../auth/AuthContext';
import { EmployeesPanel } from '../components/EmployeesPanel';
import { OrganizationForm } from '../components/OrganizationForm';
import { OrgLogo } from '../components/OrgLogo';
import { notifyError, notifyOk, PageHeader, QueryState, Section, StatusBadge } from '../components/common';
import { StatusHistory } from './OrganizationPage';

export function MyOrganizationPage() {
  const me = useMe();
  const { can } = useAuth();
  const qc = useQueryClient();
  const orgId = me.organization?.id;
  const org = useQuery({ queryKey: ['organization', orgId], queryFn: () => api<Organization>(`/organizations/${orgId}`), enabled: !!orgId });
  if (!orgId) return <Navigate to="/" replace />;

  const save = async (values: object) => {
    try {
      await api(`/organizations/${orgId}`, { method: 'PATCH', body: values as Record<string, unknown> });
      await qc.invalidateQueries({ queryKey: ['organization', orgId] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      notifyOk('Изменения сохранены');
    } catch (e) {
      notifyError(e);
      throw e;
    }
  };

  const individual = me.organization?.kind === 'INDIVIDUAL';
  return (
    <QueryState isLoading={org.isLoading} error={org.error}>
      {org.data && (
        <Stack>
          <PageHeader
            title={org.data.shortName || org.data.name}
            description={
              <Group gap="xs">
                <StatusBadge status={org.data.status} />
                <Text size="sm" c="dimmed">
                  {org.data.region?.name}
                </Text>
              </Group>
            }
            actions={<OrgLogo org={org.data} size={64} editable={can('org.edit_own')} />}
          />
          {org.data.status === 'CANDIDATE' && (
            <Alert icon={<IconInfoCircle />} color="yellow" title="Заявка на вступление рассматривается">
              Заполните профиль как можно подробнее — он поможет членам Альянса принять решение. О результате вы получите уведомление.
            </Alert>
          )}
          <Tabs defaultValue="profile" keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="profile">{individual ? 'Профиль' : 'Профиль организации'}</Tabs.Tab>
              {!individual && can('employees.manage_own') && <Tabs.Tab value="employees">Сотрудники</Tabs.Tab>}
              <Tabs.Tab value="history">История статуса</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="profile" pt="md">
              <Section title="Данные">
                <OrganizationForm initial={org.data} individual={individual} onSubmit={save} />
              </Section>
            </Tabs.Panel>
            <Tabs.Panel value="employees" pt="md">
              <Section title="Сотрудники и зоны ответственности">
                <Text size="sm" c="dimmed" mb="md">
                  Укажите, кто в вашей организации отвечает за мероприятия, взносы, участие в рабочих группах. Эти контакты видны администратору и
                  секретарю Альянса.
                </Text>
                <EmployeesPanel orgId={orgId} editable />
              </Section>
            </Tabs.Panel>
            <Tabs.Panel value="history" pt="md">
              <Section title="История статуса">
                <StatusHistory orgId={orgId} />
              </Section>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
    </QueryState>
  );
}

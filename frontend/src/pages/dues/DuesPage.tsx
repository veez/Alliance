import { Stack, Tabs } from '@mantine/core';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/common';
import { AgreementsTab } from './AgreementsTab';
import { DuesRegistry } from './DuesRegistry';
import { OrgDuesHistory } from './DuesShared';

export function DuesPage() {
  const { can, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const readAll = can('dues.read_all') || can('dues.manage');
  const ownOrg = me?.organization && can('dues.read_own') ? me.organization.id : null;

  if (!readAll) {
    return (
      <Stack>
        <PageHeader title="Мои взносы" description="Ежегодные членские взносы, платёжные документы и договоры пожертвования вашей организации" />
        {ownOrg && <OrgDuesHistory orgId={ownOrg} />}
      </Stack>
    );
  }

  const manage = can('dues.manage');
  const requested = params.get('tab') ?? 'registry';
  const tab = requested === 'agreements' && !manage ? 'registry' : requested;
  return (
    <Stack>
      <PageHeader title="Взносы и договоры" description="Учёт ежегодных членских взносов и договоров пожертвования" />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'registry' })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="registry">Реестр взносов</Tabs.Tab>
          {manage && <Tabs.Tab value="agreements">Договоры пожертвования</Tabs.Tab>}
          {ownOrg && <Tabs.Tab value="mine">Моя организация</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="registry">
          <DuesRegistry />
        </Tabs.Panel>
        {manage && (
          <Tabs.Panel value="agreements">
            <AgreementsTab />
          </Tabs.Panel>
        )}
        {ownOrg && (
          <Tabs.Panel value="mine">
            <OrgDuesHistory orgId={ownOrg} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

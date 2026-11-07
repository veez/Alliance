import { AppShell, Avatar, Badge, Burger, Group, Menu, NavLink, ScrollArea, Text, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAddressBook,
  IconBell,
  IconBuildingCommunity,
  IconCalendarEvent,
  IconChevronDown,
  IconCoin,
  IconHome,
  IconListCheck,
  IconLogout,
  IconMap2,
  IconShieldLock,
  IconUser,
  IconUsers,
  IconUsersGroup,
  IconBuilding,
  IconHistory,
  IconSettings,
  type Icon,
} from '@tabler/icons-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useMe } from '../auth/AuthContext';
import { ORG_STATUS, SYSTEM_ROLE } from '../labels';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  show?: boolean;
  soon?: boolean;
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const me = useMe();
  const { can, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const main: NavItem[] = [
    { to: '/', label: 'Главная', icon: IconHome },
    {
      to: '/my-organization',
      label: 'Моя организация',
      icon: IconBuilding,
      show: !!me.organization,
    },
    {
      to: '/organizations',
      label: 'Участники Альянса',
      icon: IconBuildingCommunity,
    },
    {
      to: '/votes',
      label: 'Голосования',
      icon: IconListCheck,
      show: can('vote.cast') || can('votes.read_all') || me.organization?.status === 'CANDIDATE',
    },
    { to: '/events', label: 'Мероприятия', icon: IconCalendarEvent },
    {
      to: '/working-groups',
      label: 'Рабочие группы',
      icon: IconUsersGroup,
      show: can('wg.participate') || can('wg.read_all'),
    },
    {
      to: '/dues',
      label: 'Взносы',
      icon: IconCoin,
      show: can('dues.read_own') || can('dues.read_all'),
    },
    { to: '/map', label: 'Карта', icon: IconMap2, show: can('map.read') },
    {
      to: '/contacts',
      label: 'Контакты',
      icon: IconAddressBook,
      show: can('contacts.read'),
    },
  ];
  const admin: NavItem[] = [
    {
      to: '/admin/users',
      label: 'Пользователи',
      icon: IconUsers,
      show: can('users.manage'),
    },
    {
      to: '/admin/settings',
      label: 'Настройки',
      icon: IconSettings,
      show: can('settings.manage'),
    },
    {
      to: '/admin/audit',
      label: 'Журнал аудита',
      icon: IconHistory,
      show: can('audit.read'),
    },
  ];

  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));
  const renderItem = (item: NavItem) =>
    item.show === false ? null : (
      <NavLink
        key={item.to}
        component={Link}
        to={item.to}
        label={item.label}
        leftSection={<item.icon size={18} stroke={1.6} />}
        rightSection={
          item.soon ? (
            <Badge size="xs" variant="light" color="gray">
              скоро
            </Badge>
          ) : null
        }
        active={isActive(item.to)}
        onClick={close}
      />
    );
  const visibleAdmin = admin.filter((i) => i.show !== false);
  const roleLabel = me.systemRole !== 'USER' ? SYSTEM_ROLE[me.systemRole] : me.organization ? ORG_STATUS[me.organization.status].label : 'Пользователь';

  return (
    <AppShell header={{ height: 60 }} navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
            <img src="/favicon.svg" width={30} height={30} alt="" />
            <div>
              <Text fw={600} size="sm" lh={1.2}>
                Альянс «Ценность каждого»
              </Text>
              <Text size="xs" c="dimmed" visibleFrom="xs">
                Служебный портал
              </Text>
            </div>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <NotificationBell />
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <UnstyledButton>
                  <Group gap="xs" wrap="nowrap">
                    <Avatar color="brand" radius="xl" size={32}>
                      {me.fullName.slice(0, 1)}
                    </Avatar>
                    <div style={{ maxWidth: 200 }}>
                      <Text size="sm" fw={500} truncate visibleFrom="sm">
                        {me.fullName}
                      </Text>
                      <Text size="xs" c="dimmed" truncate visibleFrom="sm">
                        {roleLabel}
                      </Text>
                    </div>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.email}</Menu.Label>
                <Menu.Item leftSection={<IconUser size={16} />} onClick={() => navigate('/profile')}>
                  Профиль и безопасность
                </Menu.Item>
                <Menu.Item leftSection={<IconBell size={16} />} onClick={() => navigate('/notifications?tab=settings')}>
                  Настройки уведомлений
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={() => signOut().then(() => navigate('/login'))}>
                  Выйти
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea}>
          {main.map(renderItem)}
          {visibleAdmin.length > 0 && (
            <>
              <Group gap={6} mt="md" mb={4} px="sm" c="dimmed">
                <IconShieldLock size={14} />
                <Text size="xs" fw={600} tt="uppercase">
                  Администрирование
                </Text>
              </Group>
              {visibleAdmin.map(renderItem)}
            </>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

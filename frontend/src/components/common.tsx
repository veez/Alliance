import { Alert, Badge, Card, Center, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ReactNode } from 'react';
import { ApiError } from '../api/client';
import type { OrganizationStatus } from '../api/types';
import { ORG_STATUS } from '../labels';

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Что-то пошло не так';
}

export const notifyError = (e: unknown) => notifications.show({ color: 'red', title: 'Ошибка', message: errorText(e) });
export const notifyOk = (message: string) => notifications.show({ color: 'teal', message });

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-bg">
      <Paper w="100%" maw={420} p="xl" radius="lg" shadow="md" withBorder>
        <Stack gap="lg">
          <Group gap="sm" wrap="nowrap">
            <img src="/favicon.svg" width={40} height={40} alt="" />
            <div>
              <Text fw={600}>Альянс «Ценность каждого»</Text>
              <Text size="xs" c="dimmed">
                Служебный портал для членов Альянса
              </Text>
            </div>
          </Group>
          <div>
            <Title order={3}>{title}</Title>
            {subtitle && (
              <Text size="sm" c="dimmed" mt={4}>
                {subtitle}
              </Text>
            )}
          </div>
          {children}
        </Stack>
      </Paper>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg" gap="sm">
      <div>
        <Title order={2}>{title}</Title>
        {description && (
          <Text c="dimmed" size="sm" mt={4} component="div">
            {description}
          </Text>
        )}
      </div>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}

export function StatusBadge({ status }: { status: OrganizationStatus }) {
  const s = ORG_STATUS[status];
  return (
    <Badge color={s.color} variant="light">
      {s.label}
    </Badge>
  );
}

export function QueryState({ isLoading, error, children }: { isLoading: boolean; error: unknown; children: ReactNode }) {
  if (isLoading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  if (error)
    return (
      <Alert color="red" icon={<IconAlertTriangle />} title="Не удалось загрузить данные">
        {errorText(error)}
      </Alert>
    );
  return <>{children}</>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="md">
        <Title order={4}>{title}</Title>
        {actions}
      </Group>
      {children}
    </Card>
  );
}

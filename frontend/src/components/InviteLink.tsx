import { Alert, Button, CopyButton, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

export interface InviteResult {
  inviteLink: string;
  emailSent: boolean;
}

/** Ссылка-приглашение: её можно скопировать и отправить через любой канал связи. */
export function InviteLink({ result }: { result: InviteResult }) {
  return (
    <Alert color="teal" title="Приглашение готово">
      <Stack gap="xs">
        <Text size="sm">
          Скопируйте ссылку и отправьте её человеку удобным способом: в мессенджере, по телефону или лично. Ссылка личная и действует 7 дней.
          {result.emailSent ? ' Письмо с этой ссылкой также отправлено на почту.' : ''}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput value={result.inviteLink} readOnly style={{ flex: 1 }} size="xs" aria-label="Ссылка-приглашение" onFocus={(e) => e.currentTarget.select()} />
          <CopyButton value={result.inviteLink}>
            {({ copied, copy }) => (
              <Button size="xs" onClick={copy} color={copied ? 'teal' : 'brand'} leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}>
                {copied ? 'Скопировано' : 'Копировать'}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Alert>
  );
}

import { Alert, Badge, Button, Group, Modal, PasswordInput, PinInput, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconShieldCheck } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useAuth, useMe } from '../auth/AuthContext';
import { errorText, notifyError, notifyOk, PageHeader, Section } from '../components/common';
import { SYSTEM_ROLE } from '../labels';
import { PASSWORD_MIN } from './auth/InvitePage';
import { TotpEnroll } from './auth/Setup2faPage';

function ProfileForm() {
  const me = useMe();
  const qc = useQueryClient();
  const form = useForm({
    initialValues: { fullName: me.fullName, position: me.position ?? '', phone: me.phone ?? '' },
    validate: { fullName: (v) => (v.trim().length >= 2 ? null : 'Укажите ФИО') },
  });
  const save = useMutation({
    mutationFn: (v: typeof form.values) => api('/profile', { method: 'PATCH', body: v }),
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ['me'] });
      form.resetDirty(v);
      notifyOk('Профиль сохранён');
    },
    onError: notifyError,
  });
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <TextInput label="ФИО" {...form.getInputProps('fullName')} />
          <TextInput label="Должность" {...form.getInputProps('position')} />
          <TextInput label="Телефон" {...form.getInputProps('phone')} />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function PasswordForm() {
  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirm: '' },
    validate: {
      currentPassword: (v) => (v ? null : 'Введите текущий пароль'),
      newPassword: (v) => (v.length >= PASSWORD_MIN ? null : `Не короче ${PASSWORD_MIN} символов`),
      confirm: (v, all) => (v === all.newPassword ? null : 'Пароли не совпадают'),
    },
  });
  const change = useMutation({
    mutationFn: (v: typeof form.values) => api('/auth/password/change', { method: 'POST', body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }),
    onSuccess: () => {
      form.reset();
      notifyOk('Пароль изменён');
    },
    onError: notifyError,
  });
  return (
    <form onSubmit={form.onSubmit((v) => change.mutate(v))}>
      <Stack>
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <PasswordInput label="Текущий пароль" autoComplete="current-password" {...form.getInputProps('currentPassword')} />
          <PasswordInput label="Новый пароль" autoComplete="new-password" {...form.getInputProps('newPassword')} />
          <PasswordInput label="Повторите новый пароль" autoComplete="new-password" {...form.getInputProps('confirm')} />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" loading={change.isPending}>
            Изменить пароль
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function TwoFactor() {
  const me = useMe();
  const { reload } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState('');
  const disable = useMutation({
    mutationFn: (c: string) => api('/auth/2fa/disable', { method: 'POST', body: { code: c } }),
    onSuccess: async () => {
      await reload();
      setDisabling(false);
      notifyOk('Двухфакторная аутентификация отключена');
    },
    onError: () => setCode(''),
  });

  return (
    <Stack>
      <Group>
        {me.totpEnabled ? (
          <Badge color="teal" leftSection={<IconShieldCheck size={14} />} size="lg" variant="light">
            Включена
          </Badge>
        ) : (
          <Badge color="gray" size="lg" variant="light">
            Не включена
          </Badge>
        )}
        {me.mfaRequired && <Text size="sm" c="dimmed">Обязательна для роли «{SYSTEM_ROLE[me.systemRole]}»</Text>}
      </Group>
      <Text size="sm" c="dimmed">
        При входе кроме пароля потребуется код из приложения-аутентификатора на телефоне.
      </Text>
      <Group>
        {!me.totpEnabled && <Button onClick={() => setEnrolling(true)}>Включить</Button>}
        {me.totpEnabled && !me.mfaRequired && (
          <Button variant="light" color="red" onClick={() => setDisabling(true)}>
            Отключить
          </Button>
        )}
      </Group>
      <Modal opened={enrolling} onClose={() => setEnrolling(false)} title="Включение 2FA">
        {enrolling && (
          <TotpEnroll
            onDone={async () => {
              await reload();
              setEnrolling(false);
              notifyOk('Двухфакторная аутентификация включена');
            }}
          />
        )}
      </Modal>
      <Modal opened={disabling} onClose={() => setDisabling(false)} title="Отключение 2FA">
        <Stack>
          <Text size="sm">Введите текущий код из приложения:</Text>
          {disable.error && <Alert color="red">{errorText(disable.error)}</Alert>}
          <PinInput length={6} type="number" value={code} onChange={setCode} onComplete={(v) => disable.mutate(v)} />
        </Stack>
      </Modal>
    </Stack>
  );
}

export function ProfilePage() {
  const me = useMe();
  return (
    <Stack>
      <PageHeader title="Профиль и безопасность" description={me.email} />
      <Section title="Личные данные">
        <ProfileForm />
      </Section>
      <Section title="Пароль">
        <PasswordForm />
      </Section>
      <Section title="Двухфакторная аутентификация">
        <TwoFactor />
      </Section>
    </Stack>
  );
}

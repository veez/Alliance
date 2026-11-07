import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AuthCard, errorText } from '../../components/common';
import { PASSWORD_MIN, passwordRules } from './InvitePage';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ initialValues: { email: '' }, validate: { email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Введите email') } });

  const submit = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: values });
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  });

  return (
    <AuthCard title="Восстановление пароля" subtitle="Пришлём ссылку для сброса на ваш email">
      {sent ? (
        <Alert color="teal">Если учётная запись с таким email существует, на него отправлено письмо со ссылкой. Ссылка действует 1 час.</Alert>
      ) : (
        <form onSubmit={submit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Email" type="email" autoFocus {...form.getInputProps('email')} />
            <Button type="submit" loading={busy}>
              Отправить ссылку
            </Button>
          </Stack>
        </form>
      )}
      <Text size="sm" ta="center">
        <Anchor component={Link} to="/login">
          ← Ко входу
        </Anchor>
      </Text>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({ initialValues: { password: '', confirm: '' }, validate: (v) => passwordRules(v) });

  const submit = form.onSubmit(async ({ password }) => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  });

  return (
    <AuthCard title="Новый пароль">
      {done ? (
        <Stack>
          <Alert color="teal">Пароль изменён. Все открытые сессии завершены.</Alert>
          <Button component={Link} to="/login">
            Войти
          </Button>
        </Stack>
      ) : (
        <form onSubmit={submit}>
          <Stack>
            {error && <Alert color="red">{error}</Alert>}
            <PasswordInput label="Новый пароль" description={`Не короче ${PASSWORD_MIN} символов`} autoComplete="new-password" {...form.getInputProps('password')} />
            <PasswordInput label="Повторите пароль" autoComplete="new-password" {...form.getInputProps('confirm')} />
            <Button type="submit" loading={busy}>
              Сохранить пароль
            </Button>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}

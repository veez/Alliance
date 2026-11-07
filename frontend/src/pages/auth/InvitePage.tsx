import { Alert, Anchor, Button, Center, Loader, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthCard, errorText } from '../../components/common';
import { fmtDateTime } from '../../labels';

export const PASSWORD_MIN = 10;

export function passwordRules(values: { password: string; confirm: string }) {
  return {
    password: values.password.length >= PASSWORD_MIN ? null : `Не короче ${PASSWORD_MIN} символов`,
    confirm: values.confirm === values.password ? null : 'Пароли не совпадают',
  };
}

export function InvitePage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<{ email: string; fullName: string; organizationName: string | null; expiresAt: string }>(`/auth/invitations/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  const form = useForm({ initialValues: { password: '', confirm: '' }, validate: (v) => passwordRules(v) });

  const submit = form.onSubmit(async ({ password }) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>('/auth/invitations/accept', { method: 'POST', body: { token, password } });
      await signIn(res.accessToken);
      navigate('/', { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  });

  if (info.isLoading)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  if (!token || info.error)
    return (
      <AuthCard title="Приглашение недействительно">
        <Text size="sm">Ссылка устарела или уже использована. Попросите администратора Альянса отправить приглашение повторно.</Text>
        <Anchor component={Link} to="/login">
          Перейти ко входу
        </Anchor>
      </AuthCard>
    );

  const d = info.data!;
  return (
    <AuthCard
      title={`Добро пожаловать, ${d.fullName}!`}
      subtitle={
        <>
          {d.organizationName ? `Вы приглашены как представитель «${d.organizationName}». ` : ''}
          Придумайте пароль. Приглашение действует до {fmtDateTime(d.expiresAt)}.
        </>
      }
    >
      <form onSubmit={submit}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput label="Email (логин)" value={d.email} readOnly />
          <PasswordInput label="Пароль" description={`Не короче ${PASSWORD_MIN} символов`} autoComplete="new-password" {...form.getInputProps('password')} />
          <PasswordInput label="Повторите пароль" autoComplete="new-password" {...form.getInputProps('confirm')} />
          <Button type="submit" loading={busy}>
            Задать пароль и войти
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}

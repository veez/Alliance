import { Alert, Anchor, Button, PasswordInput, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthCard, errorText } from '../../components/common';

type LoginResponse = { twoFactorRequired: false; accessToken: string } | { twoFactorRequired: true; challengeToken: string };

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Введите email'),
      password: (v) => (v ? null : 'Введите пароль'),
    },
  });

  const finish = async (token: string) => {
    await signIn(token);
    navigate(from, { replace: true });
  };

  const submitPassword = form.onSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: values });
      if (res.twoFactorRequired) setChallenge(res.challengeToken);
      else await finish(res.accessToken);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  });

  const submitCode = async (value = code) => {
    if (value.length !== 6 || !challenge) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string }>('/auth/login/2fa', { method: 'POST', body: { challengeToken: challenge, code: value } });
      await finish(res.accessToken);
    } catch (e) {
      setError(errorText(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <AuthCard title="Подтверждение входа" subtitle="Введите 6-значный код из приложения-аутентификатора">
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <PinInput
            length={6}
            type="number"
            oneTimeCode
            autoFocus
            value={code}
            onChange={setCode}
            onComplete={(v) => void submitCode(v)}
            disabled={busy}
            size="lg"
            style={{ justifyContent: 'center' }}
          />
          <Button onClick={() => void submitCode()} loading={busy} disabled={code.length !== 6}>
            Войти
          </Button>
          <Anchor component="button" size="sm" onClick={() => setChallenge(null)}>
            ← Назад
          </Anchor>
        </Stack>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Вход" subtitle="Доступ выдаётся по приглашению администратора Альянса">
      <form onSubmit={submitPassword}>
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput label="Email" type="email" autoComplete="username" autoFocus {...form.getInputProps('email')} />
          <PasswordInput label="Пароль" autoComplete="current-password" {...form.getInputProps('password')} />
          <Button type="submit" loading={busy} fullWidth>
            Войти
          </Button>
          <Text size="sm" ta="center">
            <Anchor component={Link} to="/forgot-password">
              Забыли пароль?
            </Anchor>
          </Text>
        </Stack>
      </form>
    </AuthCard>
  );
}

import { Alert, Button, Center, Code, Image, Loader, PinInput, Stack, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthCard, errorText } from '../../components/common';

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/** QR-код + ввод кода. Используется на обязательной странице и в профиле. */
export function TotpEnroll({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const setup = useQuery({ queryKey: ['totp-setup'], queryFn: () => api<TotpSetup>('/auth/2fa/setup', { method: 'POST' }), staleTime: Infinity, gcTime: 0, retry: false });
  const enable = useMutation({
    mutationFn: (c: string) => api('/auth/2fa/enable', { method: 'POST', body: { code: c } }),
    onSuccess: onDone,
    onError: () => setCode(''),
  });

  if (setup.isLoading)
    return (
      <Center py="lg">
        <Loader />
      </Center>
    );
  if (setup.error) return <Alert color="red">{errorText(setup.error)}</Alert>;
  const s = setup.data!;
  return (
    <Stack>
      <Text size="sm">
        1. Установите приложение-аутентификатор (Яндекс Ключ, Google Authenticator, FreeOTP и т. п.) и отсканируйте QR-код.
      </Text>
      <Center>
        <Image src={s.qrDataUrl} w={200} h={200} alt="QR-код для приложения-аутентификатора" />
      </Center>
      <Text size="xs" c="dimmed" ta="center">
        Или введите ключ вручную: <Code>{s.secret}</Code>
      </Text>
      <Text size="sm">2. Введите 6-значный код из приложения:</Text>
      {enable.error && <Alert color="red">{errorText(enable.error)}</Alert>}
      <Center>
        <PinInput length={6} type="number" oneTimeCode value={code} onChange={setCode} onComplete={(v) => enable.mutate(v)} disabled={enable.isPending} />
      </Center>
      <Button onClick={() => enable.mutate(code)} loading={enable.isPending} disabled={code.length !== 6}>
        Включить двухфакторную аутентификацию
      </Button>
    </Stack>
  );
}

export function Setup2faPage() {
  const { me, reload, signOut } = useAuth();
  const navigate = useNavigate();
  if (me && !me.mfaSetupPending) return <Navigate to="/" replace />;
  return (
    <AuthCard
      title="Настройка двухфакторной аутентификации"
      subtitle="Для администратора и секретаря Альянса вход по второму фактору обязателен. Без него доступ к данным закрыт."
    >
      <TotpEnroll
        onDone={async () => {
          await reload();
          navigate('/', { replace: true });
        }}
      />
      <Button variant="subtle" color="gray" onClick={() => signOut().then(() => navigate('/login'))}>
        Выйти
      </Button>
    </AuthCard>
  );
}

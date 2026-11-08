import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, refreshAccessToken, tokenStore } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  can: (permission: string) => boolean;
  /** Сохранить токен после входа/принятия приглашения и загрузить профиль. */
  signIn: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<unknown>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // При загрузке страницы пробуем восстановить сессию по refresh-cookie
  const [booted, setBooted] = useState(false);
  const [signedOutAt, setSignedOutAt] = useState(0);
  useEffect(() => {
    refreshAccessToken().finally(() => setBooted(true));
  }, []);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    enabled: booted && !!tokenStore.get(),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(
    () =>
      tokenStore.onSessionLost(() => {
        qc.setQueryData(['me'], null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      }),
    [qc],
  );

  const signIn = useCallback(
    async (token: string) => {
      tokenStore.set(token);
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // Сервер недоступен — локальную сессию всё равно завершаем
    }
    tokenStore.set(null);
    // Запрос ['me'] не удаляем: на нём держится подписка AuthProvider, нужная для следующего входа
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    // Контекст должен обновиться до перехода на /login, иначе GuestOnly вернёт на главную
    flushSync(() => setSignedOutAt(Date.now()));
  }, [qc]);

  const me = tokenStore.get() ? (meQuery.data ?? null) : null;
  const value = useMemo<AuthState>(
    () => ({
      me,
      loading: !booted || (!!tokenStore.get() && meQuery.isLoading),
      can: (p) => !!me?.permissions.includes(p),
      signIn,
      signOut,
      reload: () => meQuery.refetch(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signedOutAt: токен живёт вне React
    [me, booted, meQuery, signIn, signOut, signedOutAt],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth вне AuthProvider');
  return v;
}

export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Пользователь не загружен');
  return me;
}

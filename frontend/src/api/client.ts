/**
 * HTTP-клиент. Access-токен хранится только в памяти (не в localStorage — защита от кражи при XSS),
 * refresh-токен — в httpOnly-cookie. При 401 клиент один раз пробует обновить токен.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export const tokenStore = {
  get: () => accessToken,
  set(token: string | null) {
    accessToken = token;
  },
  /** Подписка на «сессия потеряна» (refresh не удался). */
  onSessionLost(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function extractMessage(body: unknown, fallback: string): { message: string; code?: string } {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; code?: string };
    if (Array.isArray(b.message)) return { message: b.message.join('; '), code: b.code };
    if (typeof b.message === 'string') return { message: b.message, code: b.code };
  }
  return { message: fallback };
}

export async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-CSRF': '1' } });
      if (!res.ok) return false;
      tokenStore.set((await res.json()).accessToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshInFlight = null), 0);
    }
  })();
  return refreshInFlight;
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T = unknown>(path: string, options: { method?: string; body?: Body; retry?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, retry = true } = options;
  const headers: Record<string, string> = { 'X-CSRF': '1' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await refreshAccessToken()) return api<T>(path, { ...options, retry: false });
    tokenStore.set(null);
    listeners.forEach((fn) => fn());
  }

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* пустой ответ */
    }
    const { message, code } = extractMessage(parsed, `Ошибка ${res.status}`);
    throw new ApiError(res.status, message, code, parsed);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

/** Загрузка бинарных данных с авторизацией (например, логотипов) в object URL. */
export async function fetchObjectUrl(path: string): Promise<string | null> {
  try {
    const blob = await api<Blob>(path);
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Скачать файл с авторизацией (PDF-протокол, CSV, вложения). */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res = await fetch(`/api${path}`, { headers, credentials: 'include' });
  if (res.status === 401 && (await refreshAccessToken())) {
    res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'include' });
  }
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      message = extractMessage(await res.json(), message).message;
    } catch {
      /* не JSON */
    }
    throw new ApiError(res.status, message);
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

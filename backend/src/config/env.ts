import { config as loadDotenv } from 'dotenv';

loadDotenv();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number.parseInt(v, 10) : fallback;
}

/** Типизированная конфигурация приложения. Читается один раз при старте. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: int('PORT', 3000),
  // На Render адрес сервиса приходит в RENDER_EXTERNAL_URL
  appUrl: required('APP_URL', process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  databaseUrl: required('DATABASE_URL'),

  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtlDays: int('REFRESH_TTL_DAYS', 30),
  totpEncKey: Buffer.from(required('TOTP_ENC_KEY'), 'base64'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int('SMTP_PORT', 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'Альянс «Ценность каждого» <noreply@mental-alliance.ru>',
  },

  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  storageDir: process.env.STORAGE_DIR ?? 'var/files',
  /** Каталог собранного фронтенда: если задан, API сам отдаёт SPA (один контейнер для демо-стенда) */
  staticDir: process.env.STATIC_DIR ?? '',

  loginMaxFailed: int('LOGIN_MAX_FAILED', 5),
  loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
};

if (env.totpEncKey.length !== 32) {
  throw new Error('TOTP_ENC_KEY должен быть 32 байтами в base64');
}
if (process.env.DISABLE_2FA === 'true') {
  // eslint-disable-next-line no-console
  console.warn('ВНИМАНИЕ: DISABLE_2FA=true — двухфакторная аутентификация отключена (только для демо-стенда)');
}
if (env.isProd && env.jwtAccessSecret.startsWith('dev-')) {
  throw new Error('В production задайте собственный JWT_ACCESS_SECRET');
}

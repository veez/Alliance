// Перед тестами: создаёт ОТДЕЛЬНУЮ временную БД для этого прогона, применяет миграции и сиды.
// Рабочая БД (DATABASE_URL) не затрагивается. Временная БД удаляется в global-teardown.
import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { Client } from 'pg';

export default async function globalSetup() {
  config();
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('Не задан TEST_DATABASE_URL');

  const dbName = `alliance_test_${Date.now()}`;
  const admin = new URL(base);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();

  const url = new URL(base);
  url.pathname = `/${dbName}`;
  process.env.TEST_RUN_DATABASE_URL = url.toString();
  process.env.TEST_RUN_DATABASE_NAME = dbName;

  const env = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test' };
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { env, stdio: 'ignore' });
}

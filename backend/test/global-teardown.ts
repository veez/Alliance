// Удаляет только временную БД, созданную этим прогоном тестов (alliance_test_<timestamp>).
import { Client } from 'pg';

export default async function globalTeardown() {
  const name = process.env.TEST_RUN_DATABASE_NAME;
  const base = process.env.TEST_DATABASE_URL;
  if (!name || !base || !/^alliance_test_\d+$/.test(name)) return;
  const admin = new URL(base);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.end();
}

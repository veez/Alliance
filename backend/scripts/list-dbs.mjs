// Служебное: список БД портала на локальном сервере разработки (проверка, что временные тестовые БД удалены).
import pg from 'pg';

const port = Number(process.env.DEV_DB_PORT ?? 54329);
const c = new pg.Client({ host: 'localhost', port, user: 'alliance', password: 'alliance', database: 'postgres' });
await c.connect();
const r = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'alliance%' ORDER BY 1");
console.log(r.rows.map((x) => x.datname).join('\n'));
await c.end();

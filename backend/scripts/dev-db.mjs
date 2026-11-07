// Локальный PostgreSQL для разработки без Docker (бинарники из npm-пакета embedded-postgres).
//
//   npm run db:start   — инициализирует (при первом запуске) и запускает сервер в фоне
//   npm run db:stop    — останавливает сервер
//   npm run db:status  — статус
//
// PostgreSQL на Windows не работает с не-ASCII путями (у нас «D:\Разработка\Альянс»).
// Поэтому скрипт обращается к бинарникам и данным через ASCII-путь DEV_ASCII_ROOT
// (по умолчанию D:\alliance-portal — junction на корень проекта, создаётся автоматически).
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import pg from 'pg';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const asciiRoot = process.env.DEV_ASCII_ROOT ?? 'D:\\alliance-portal';
const port = Number(process.env.DEV_DB_PORT ?? 54329);
const user = 'alliance';
const password = 'alliance';
const databases = ['alliance', 'alliance_test'];

const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);

function ensureAsciiRoot() {
  if (isAscii(projectRoot)) return projectRoot;
  if (!existsSync(asciiRoot)) {
    const r = spawnSync('cmd', ['/c', 'mklink', '/J', asciiRoot, projectRoot], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Не удалось создать junction ${asciiRoot}: ${r.stderr || r.stdout}`);
  }
  return asciiRoot;
}

const root = ensureAsciiRoot();
const bin = join(root, 'backend', 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const dataDir = join(root, 'backend', 'var', 'pgdata');
const logFile = join(root, 'backend', 'var', 'postgres.log');
const exe = (name) => join(bin, process.platform === 'win32' ? `${name}.exe` : name);
const env = { ...process.env, LC_ALL: 'C', LC_MESSAGES: 'C', PGPASSWORD: password };

function run(name, args, opts = {}) {
  const r = spawnSync(exe(name), args, { encoding: 'utf8', env, ...opts });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

async function start() {
  mkdirSync(join(projectRoot, 'backend', 'var'), { recursive: true });
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    const pwFile = join(tmpdir(), `alliance-pw-${process.pid}`);
    writeFileSync(pwFile, password);
    const r = run('initdb', ['-D', dataDir, '-U', user, `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '-A', 'scram-sha-256']);
    rmSync(pwFile, { force: true });
    if (r.code !== 0) throw new Error(`initdb: ${r.out}`);
    console.log('Кластер PostgreSQL инициализирован');
  }
  if (run('pg_ctl', ['status', '-D', dataDir]).code !== 0) {
    // stdio: 'ignore' — иначе фоновый postgres унаследует pipe и spawnSync не вернётся.
    const r = run('pg_ctl', ['start', '-D', dataDir, '-l', logFile, '-w', '-o', `-p ${port} -c listen_addresses=localhost -c timezone=UTC`], { stdio: 'ignore' });
    if (r.code !== 0) throw new Error(`pg_ctl start завершился с кодом ${r.code}. См. лог: ${logFile}`);
  }
  const client = new pg.Client({ host: 'localhost', port, user, password, database: 'postgres' });
  await client.connect();
  for (const db of databases) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (!rowCount) await client.query(`CREATE DATABASE ${db}`);
  }
  await client.end();
  console.log(`PostgreSQL запущен: postgresql://${user}:${password}@localhost:${port}/alliance (+ alliance_test)`);
}

const cmd = process.argv[2] ?? 'start';
if (cmd === 'start') await start();
else if (cmd === 'stop') console.log(run('pg_ctl', ['stop', '-D', dataDir, '-m', 'fast']).out);
else if (cmd === 'status') console.log(run('pg_ctl', ['status', '-D', dataDir]).out);
else throw new Error(`Неизвестная команда: ${cmd}`);

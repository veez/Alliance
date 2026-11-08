/**
 * Импорт реальных данных Альянса из CSV-выгрузок листов таблицы «Списки Альянса».
 * Сами данные в репозиторий не попадают: папка с CSV указывается при запуске.
 *
 * Проверка без записи: npx ts-node --transpile-only prisma/import-alliance.ts <папка>
 * Запись в базу:       npx ts-node --transpile-only prisma/import-alliance.ts <папка> --apply
 *
 * Файлы: members.csv, partners.csv, board.csv, candidates.csv, applicants.csv, rejected.csv, groups.csv.
 * Телефоны, почта и мессенджеры импортируются скрытыми: их открывают после согласия человека.
 * Повторный запуск уже загруженные организации и группы не меняет.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrganizationKind, OrganizationNoteKind, OrganizationStatus, PrismaClient } from '@prisma/client';

const HIDDEN = { hideEmail: true, hidePhone: true, hideMessengers: true, hideFromDirectory: false };
const SOURCE = 'Импорт из таблицы «Списки Альянса»';

export interface Person {
  fullName: string;
  position: string | null;
  tags: string[];
  vk: string | null;
  telegram: string | null;
  phone: string | null;
  email: string | null;
  notes: string[];
  isPrimary: boolean;
}

interface Org {
  name: string;
  shortName: string | null;
  altName: string | null;
  kind: OrganizationKind;
  status: OrganizationStatus;
  regionCode: string | null;
  regionRaw: string;
  city: string | null;
  website: string | null;
  people: Person[];
  notes: Array<{ kind: OrganizationNoteKind; body: string }>;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const clean = (v: string | undefined) => (v ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();

/** Порядок важен: область раньше города, Нижний Новгород раньше Великого. */
const REGION_RULES: Array<[RegExp, string]> = [
  [/московская/, 'RU-MOS'],
  [/видное/, 'RU-MOS'],
  [/москва/, 'RU-MOW'],
  [/петер/, 'RU-SPE'],
  [/ленинградская/, 'RU-LEN'],
  [/оренбург|^орск/, 'RU-ORE'],
  [/екатеринбург|свердловская/, 'RU-SVE'],
  [/иркутск/, 'RU-IRK'],
  [/казань|татарстан/, 'RU-TA'],
  [/киров|советск/, 'RU-KIR'],
  [/краснодар|новороссийск|сочи/, 'RU-KDA'],
  [/красноярск/, 'RU-KYA'],
  [/махачкала|дагестан/, 'RU-DA'],
  [/нижний новгород|чкаловск|нижегородская/, 'RU-NIZ'],
  [/новгород|валдай/, 'RU-NGR'],
  [/новосибирск/, 'RU-NVS'],
  [/пермь/, 'RU-PER'],
  [/псков/, 'RU-PSK'],
  [/ростов|таганрог|шахты/, 'RU-ROS'],
  [/самар|тольятти/, 'RU-SAM'],
  [/севастополь/, 'RU-SEV'],
  [/тула/, 'RU-TUL'],
  [/уфа|башкортостан/, 'RU-BA'],
  [/хабаровск/, 'RU-KHA'],
  [/ярослв|ярослав/, 'RU-YAR'],
  [/якутск|саха/, 'RU-SA'],
  [/белгород/, 'RU-BEL'],
  [/брянск|новозыбков/, 'RU-BRY'],
  [/кемерово/, 'RU-KEM'],
  [/владивосток/, 'RU-PRI'],
  [/пенза/, 'RU-PNZ'],
  [/томск/, 'RU-TOM'],
  [/ноябрьск/, 'RU-YAN'],
  [/ульяновск/, 'RU-ULY'],
  [/калининград/, 'RU-KGD'],
  [/курчатов|курская/, 'RU-KRS'],
  [/тюмень/, 'RU-TYU'],
  [/калуга/, 'RU-KLU'],
];

export function regionCode(raw: string): string | null {
  const v = clean(raw).toLowerCase();
  return REGION_RULES.find(([re]) => re.test(v))?.[1] ?? null;
}

export function cityFrom(raw: string): string | null {
  const first = clean(raw).split(',')[0].replace(/^г\.\s*/, '').trim();
  if (!first || /область|край|округ|республика/i.test(first)) return null;
  return first.replace(/Санкт-Петерубрг/, 'Санкт-Петербург');
}

export function normalizePhone(raw: string): { phone: string | null; extra: boolean } {
  const found = raw.match(/\+?\d[\d\s()-]{8,}\d/g) ?? [];
  if (!found.length) return { phone: null, extra: !!clean(raw) };
  let d = found[0]!.replace(/\D/g, '');
  if (d.length === 10) d = `7${d}`;
  if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
  const phone = d.length === 11 ? `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}` : found[0]!.trim();
  const rest = clean(raw).replace(found[0]!.trim(), '').trim();
  return { phone, extra: found.length > 1 || !!rest };
}

/** «Имя (пометка)» → имя, должность и метки Альянса. */
export function parseName(raw: string): { fullName: string; position: string | null; tags: string[] } {
  const v = clean(raw);
  const m = v.match(/^(.*?)\s*\((.*?)\)?\s*\)?$/);
  if (!m || !v.includes('(')) return { fullName: v, position: null, tags: [] };
  const note = m[2].trim();
  const low = note.toLowerCase();
  const tags = low === 'правление' ? ['BOARD'] : low === 'координатор' ? ['COORDINATOR'] : low === 'эксперт' ? ['EXPERT'] : [];
  return { fullName: m[1].trim(), position: tags.length || low === 'гармония' ? null : note, tags };
}

export function parsePerson(row: Record<string, string>, issues: string[], orgName: string): Person | null {
  const rawName = clean(row.fio);
  if (!rawName) return null;
  const notes: string[] = [];
  let parsed = parseName(rawName);
  let vk = clean(row.vk);
  if (/^https?:/.test(parsed.fullName)) {
    vk = vk || parsed.fullName;
    parsed = { fullName: 'Контакт без имени', position: null, tags: [] };
    issues.push(`Вместо ФИО ссылка: ${orgName}`);
  }
  if (!/^https?:\/\//.test(vk) || /vk\.(com|ru)\/feed/.test(vk)) vk = '';
  const rawTg = clean(row.telegram);
  const telegram = /^@[\w]+$/.test(rawTg) ? rawTg : null;
  if (rawTg && !telegram && rawTg !== '?') notes.push(`Telegram: ${rawTg}`);
  const rawPhone = (row.phone ?? '').trim();
  const { phone, extra } = normalizePhone(rawPhone);
  if (extra) notes.push(`Телефоны: ${clean(rawPhone)}`);
  const emails = (row.email ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const valid = emails.filter((e) => /^\S+@\S+\.\S+$/.test(e));
  if (valid.length > 1) notes.push(`Другая почта: ${valid.slice(1).join(', ')}`);
  if (parsed.fullName.split(' ').length === 1) issues.push(`Только имя: ${parsed.fullName} (${orgName})`);
  return { ...parsed, vk: vk || null, telegram, phone, email: valid[0] ?? null, notes, isPrimary: false };
}

const words = (name: string) => new Set(name.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean));

export function samePerson(a: Person, b: Pick<Person, 'fullName' | 'telegram'>): boolean {
  if (a.telegram && a.telegram === b.telegram) return true;
  const [x, y] = [words(a.fullName), words(b.fullName)];
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return small.size >= 2 && [...small].every((w) => big.has(w));
}

function merge(into: Person, p: Person) {
  if (p.fullName.length > into.fullName.length) into.fullName = p.fullName;
  into.position ??= p.position;
  into.vk ??= p.vk;
  into.telegram ??= p.telegram;
  into.phone ??= p.phone;
  into.email ??= p.email;
  into.tags = [...new Set([...into.tags, ...p.tags])];
  into.notes.push(...p.notes);
}

export function coreName(name: string): string {
  const quoted = name.match(/[«"„“]([^«»"„“”]+)[»"“”]/g)?.pop();
  return (quoted ?? name).replace(/[«»"„“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function header(row: string[]): Record<string, number> {
  const find = (re: RegExp) => row.findIndex((c) => re.test(c));
  return {
    org: find(/^Организация/),
    region: find(/^Регион/),
    fio: find(/^ФИО/),
    vk: find(/Вконтакте|в ВК/i),
    telegram: find(/Телеграмм/),
    phone: find(/телефон/i),
    email: find(/почта/i),
    site: find(/^Сайт/),
    decision: find(/^Решение/),
    comment: find(/^Комментарий/),
  };
}

export function pick(row: string[], h: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, i]) => [k, i >= 0 ? (row[i] ?? '') : '']));
}

function makeOrg(raw: Record<string, string>, status: OrganizationStatus, issues: string[]): Org {
  let name = clean(raw.org);
  const kind = name ? OrganizationKind.ORGANIZATION : OrganizationKind.INDIVIDUAL;
  if (!name) name = clean(raw.fio) ? `Без названия (${clean(raw.fio)})` : 'Без названия';
  let altName: string | null = null;
  let shortName: string | null = null;
  const slash = name.match(/^(.*?)\s*\/\s*(.+)$/);
  if (slash) [name, altName] = [slash[1].trim(), slash[2].trim()];
  const short = name.match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (short) [name, shortName] = [short[1].trim(), short[2].trim()];
  const regionRaw = clean(raw.region);
  const code = regionCode(regionRaw);
  if (!code && status !== 'REJECTED' && status !== 'EXPELLED') issues.push(`Регион не определён: ${name} («${regionRaw}»)`);
  const site = (raw.site ?? '').split(/\s+/).find(Boolean) ?? '';
  const notes: Org['notes'] = [];
  if (clean(raw.decision)) notes.push({ kind: OrganizationNoteKind.BOARD_DECISION, body: clean(raw.decision) });
  if ((raw.comment ?? '').trim()) notes.push({ kind: OrganizationNoteKind.COMMENT, body: raw.comment.trim() });
  return {
    name,
    shortName,
    altName,
    kind,
    status,
    regionCode: code,
    regionRaw,
    city: cityFrom(regionRaw),
    website: site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : null,
    people: [],
    notes,
  };
}

function readSheet(dir: string, file: string, status: OrganizationStatus, orgs: Org[], issues: string[]) {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`Нет файла ${path}`);
  const rows = parseCsv(readFileSync(path, 'utf8'));
  let h = header(rows[1] ?? []);
  let current: Org | null = null;
  let sheetStatus = status;
  for (const row of rows.slice(2)) {
    if (!row.some((c) => clean(c))) continue;
    const first = clean(row[0]);
    if (first === 'Исключены') {
      sheetStatus = OrganizationStatus.EXPELLED;
      current = null;
      continue;
    }
    if (/^Организация/.test(first)) {
      h = header(row);
      continue;
    }
    const raw = pick(row, h);
    const startsOrg = !!clean(raw.org) || !!clean(raw.region) || !current;
    if (startsOrg) {
      current = makeOrg(raw, sheetStatus, issues);
      orgs.push(current);
    }
    const person = parsePerson(raw, issues, current!.name);
    if (!person) continue;
    const twin = current!.people.find((p) => samePerson(p, person));
    if (twin) {
      merge(twin, person);
      issues.push(`Объединён дубль: ${twin.fullName} (${current!.name})`);
    } else current!.people.push(person);
  }
}

function applyBoard(dir: string, orgs: Org[], issues: string[]) {
  const rows = parseCsv(readFileSync(join(dir, 'board.csv'), 'utf8'));
  const h = header(rows[1] ?? []);
  for (const row of rows.slice(2)) {
    if (!row.some((c) => clean(c))) continue;
    const raw = pick(row, h);
    const name = clean(raw.org);
    const org = orgs.find((o) => o.name === name) ?? orgs.find((o) => coreName(o.name) === coreName(name) && o.status === 'MEMBER');
    const parsed = parsePerson(raw, issues, name);
    if (!org || !parsed) {
      issues.push(`Правление: не найдена организация ${name}`);
      continue;
    }
    const person = org.people.find((p) => samePerson(p, parsed));
    if (!person) {
      org.people.push({ ...parsed, tags: [...new Set([...parsed.tags, 'BOARD'])] });
      issues.push(`Правление: добавлен новый контакт в ${org.name}`);
      continue;
    }
    const note = parsed.position;
    merge(person, { ...parsed, position: null });
    person.tags = [...new Set([...person.tags, 'BOARD'])];
    if (note) person.notes.push(`Правление: ${note}`);
  }
}

function finish(org: Org) {
  const primary = org.people.find((p) => p.email) ?? org.people[0];
  if (primary) primary.isPrimary = true;
  const head = org.people.find((p) => /^(директор|исполнительный директор|исп\. директор|генеральный директор|председатель|председ\.|председатель правления|президент|руководитель)$/i.test(p.position ?? '')) ?? primary;
  return { primary, head };
}

interface Group {
  name: string;
  leaderNames: string | null;
  chatVk: string | null;
  chatTelegram: string | null;
  chatMax: string | null;
}

function readGroups(dir: string): Group[] {
  const rows = parseCsv(readFileSync(join(dir, 'groups.csv'), 'utf8'));
  return rows
    .slice(2)
    .filter((r) => clean(r[0]))
    .map((r) => {
      const urls = (r[2] ?? '').match(/https?:\/\/\S+/g) ?? [];
      return {
        name: clean(r[0]),
        leaderNames: clean(r[1]) || null,
        chatVk: urls.find((u) => /vk\.(me|com|ru)/.test(u)) ?? null,
        chatTelegram: urls.find((u) => /t\.me/.test(u)) ?? null,
        chatMax: urls.find((u) => /max\.ru/.test(u)) ?? null,
      };
    });
}

async function main() {
  const [dir, flag] = process.argv.slice(2);
  if (!dir) throw new Error('Укажите папку с CSV');
  const apply = flag === '--apply';
  const issues: string[] = [];
  const orgs: Org[] = [];
  readSheet(dir, 'members.csv', OrganizationStatus.MEMBER, orgs, issues);
  readSheet(dir, 'partners.csv', OrganizationStatus.PARTNER, orgs, issues);
  readSheet(dir, 'candidates.csv', OrganizationStatus.CANDIDATE, orgs, issues);
  readSheet(dir, 'applicants.csv', OrganizationStatus.APPLICANT, orgs, issues);
  readSheet(dir, 'rejected.csv', OrganizationStatus.REJECTED, orgs, issues);
  applyBoard(dir, orgs, issues);
  const groups = readGroups(dir);

  // Отказ при совпадении с действующей организацией того же региона — на проверку секретарю
  for (const r of orgs.filter((o) => o.status === 'REJECTED' || o.status === 'EXPELLED')) {
    const twin = orgs.find((o) => o !== r && o.status !== 'REJECTED' && o.status !== 'EXPELLED' && coreName(o.name) === coreName(r.name) && (!r.regionCode || !o.regionCode || r.regionCode === o.regionCode));
    if (twin) {
      r.notes.push({ kind: OrganizationNoteKind.COMMENT, body: `Проверить: похожая запись среди действующих — ${twin.name}` });
      issues.push(`Проверить: «${r.name}» в отказах и «${twin.name}» (${twin.status})`);
    }
  }
  const people = orgs.flatMap((o) => o.people);
  for (const o of orgs.filter((x) => x.status === 'MEMBER' && !x.people.some((p) => p.email))) issues.push(`Нет почты ни у кого: ${o.name}`);
  for (const g of groups) {
    for (const part of (g.leaderNames ?? '').split('+')) {
      const name = clean(part.replace(/\(.*$/, ''));
      if (name && !people.some((p) => samePerson(p, { fullName: name, telegram: null }))) issues.push(`Руководитель РГ не найден в списках: ${name} (${g.name})`);
    }
  }

  const byStatus: Record<string, number> = {};
  for (const o of orgs) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  console.log('Организации:', byStatus, '· контактов:', people.length, '· без почты:', people.filter((p) => !p.email).length, '· рабочих групп:', groups.length);
  console.log(`Замечания (${issues.length}):\n - ${[...new Set(issues)].join('\n - ')}`);
  if (!apply) {
    console.log('Проверка без записи. Для загрузки добавьте --apply');
    return;
  }

  const prisma = new PrismaClient();
  try {
    const valid = new Set((await prisma.region.findMany({ select: { code: true } })).map((r) => r.code));
    let created = 0;
    let skipped = 0;
    for (const o of orgs) {
      if (await prisma.organization.findFirst({ where: { name: o.name, isDemo: false }, select: { id: true } })) {
        skipped++;
        continue;
      }
      if (o.regionCode && !valid.has(o.regionCode)) throw new Error(`Неизвестный код региона ${o.regionCode}`);
      const { primary, head } = finish(o);
      await prisma.organization.create({
        data: {
          kind: o.kind,
          status: o.status,
          name: o.name,
          shortName: o.shortName,
          altName: o.altName,
          regionCode: o.regionCode,
          city: o.city,
          website: o.website,
          email: primary?.email ?? null,
          phone: primary?.phone ?? null,
          headName: head?.fullName ?? null,
          headPosition: head?.position ?? null,
          showOnMap: o.status === 'MEMBER' || o.status === 'PARTNER' || o.status === 'CANDIDATE',
          contactPrivacy: HIDDEN,
          statusHistory: { create: { fromStatus: null, toStatus: o.status, reason: SOURCE } },
          notes: { create: o.notes },
          employees: {
            create: o.people.map((p) => ({
              fullName: p.fullName,
              position: p.position,
              email: p.email,
              phone: p.phone,
              vk: p.vk,
              telegram: p.telegram,
              allianceTags: p.tags,
              isPrimary: p.isPrimary,
              notes: p.notes.length ? [...new Set(p.notes)].join('\n') : null,
              contactPrivacy: HIDDEN,
            })),
          },
        },
      });
      created++;
    }
    let groupsCreated = 0;
    for (const g of groups) {
      if (await prisma.workingGroup.findFirst({ where: { name: g.name, isDemo: false }, select: { id: true } })) continue;
      await prisma.workingGroup.create({ data: g });
      groupsCreated++;
    }
    console.log(`Загружено организаций: ${created}, уже были: ${skipped}, рабочих групп: ${groupsCreated}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

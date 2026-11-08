import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { cityFrom, normalizePhone, parseName, regionCode, samePerson } from '../prisma/import-alliance';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginSecretary } from './helpers';

describe('Демо-записи рядом с настоящими (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let secretary: string;
  let member: string;
  let demoId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    secretary = await loginSecretary(app);
    member = await login(app, 'kazhdyi@alliance.local');
    const demo = await prisma.organization.create({
      data: { name: 'Демо-фонд «Проверка»', status: 'MEMBER', regionCode: 'RU-MOW', isDemo: true, employees: { create: { fullName: 'Демо Демо' } } },
    });
    demoId = demo.id;
  });
  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { name: { in: ['Демо-фонд «Проверка»', 'Отказ «Совпадение»', 'АНО «Совпадение»'] } } });
    await app.close();
  });

  it('демо не попадает в карту и справочник', async () => {
    const map = await http().get('/api/map').set(auth(member)).expect(200);
    expect(map.body.totals.members).toBe(await prisma.organization.count({ where: { status: 'MEMBER', showOnMap: true, isDemo: false } }));
    const region = await http().get('/api/map/regions/RU-MOW').set(auth(member)).expect(200);
    expect(region.body.organizations.some((o: { id: string }) => o.id === demoId)).toBe(false);
    const people = await http().get('/api/contacts/people').query({ search: 'Демо Демо' }).set(auth(member)).expect(200);
    expect(people.body.total).toBe(0);
  });

  it('список: по умолчанию настоящие, по запросу — демо с пометкой', async () => {
    const real = await http().get('/api/organizations?pageSize=100').set(auth(member)).expect(200);
    expect(real.body.items.some((o: { id: string }) => o.id === demoId)).toBe(false);
    const demo = await http().get('/api/organizations?demo=true').set(auth(member)).expect(200);
    expect(demo.body.items).toEqual([expect.objectContaining({ id: demoId, isDemo: true })]);
  });

  it('демо-организация не получает голоса в настоящем голосовании', async () => {
    const created = await http()
      .post('/api/votes')
      .set(auth(secretary))
      .send({ title: 'Настоящее голосование', scenario: 'OTHER', endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), eligibility: 'ALL_MEMBERS', questions: [{ text: 'Утвердить?', format: 'YES_NO_ABSTAIN' }] })
      .expect(201);
    await http().post(`/api/votes/${created.body.id}/publish`).set(auth(secretary)).expect(200);
    const voters = await prisma.voteEligibleVoter.findMany({ where: { voteId: created.body.id } });
    expect(voters.length).toBeGreaterThan(0);
    expect(voters.some((v) => v.organizationId === demoId)).toBe(false);
  });

  it('журнал: читают «видящие всё», рядовой член — нет; совпадение с отказом показывается', async () => {
    const applicant = await prisma.organization.create({ data: { name: 'АНО «Совпадение»', status: 'APPLICANT', regionCode: 'RU-MOW' } });
    await prisma.organization.create({ data: { name: 'Отказ «Совпадение»', status: 'REJECTED', regionCode: 'RU-MOW' } });
    await http().get(`/api/organizations/${applicant.id}/notes`).set(auth(member)).expect(403);
    await http().post(`/api/organizations/${applicant.id}/notes`).set(auth(member)).send({ body: 'нельзя' }).expect(403);
    await http().post(`/api/organizations/${applicant.id}/notes`).set(auth(secretary)).send({ body: 'Запись секретаря', kind: 'BOARD_DECISION' }).expect(201);
    const res = await http().get(`/api/organizations/${applicant.id}/notes`).set(auth(secretary)).expect(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.rejectedMatches).toHaveLength(1);
    const list = await http().get('/api/organizations?status=REJECTED').set(auth(member)).expect(200);
    expect(list.body.items.every((o: { status: string }) => o.status !== 'REJECTED')).toBe(true);
  });

  it('скрытые мессенджеры не видны другим членам Альянса', async () => {
    const org = await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'opora@alliance.local' } } } });
    await prisma.employee.create({
      data: { organizationId: org.id, fullName: 'Скрытый Контакт', telegram: '@hidden', vk: 'https://vk.com/hidden', phone: '+7 900 000-00-00', contactPrivacy: { hideEmail: true, hidePhone: true, hideMessengers: true } },
    });
    const res = await http().get('/api/contacts/people').query({ search: 'Скрытый' }).set(auth(member)).expect(200);
    expect(res.body.items[0]).toMatchObject({ telegram: null, vk: null, phone: null });
  });
});

describe('Разбор данных таблицы', () => {
  it('регионы и города', () => {
    expect(regionCode('Москва ')).toBe('RU-MOW');
    expect(regionCode('Видное, Московская область')).toBe('RU-MOS');
    expect(regionCode('Санкт-Петерубрг')).toBe('RU-SPE');
    expect(regionCode('Нижний Новгород')).toBe('RU-NIZ');
    expect(regionCode('Валдай')).toBe('RU-NGR');
    expect(regionCode('Орск, Оренбургская область')).toBe('RU-ORE');
    expect(regionCode('Ноябрьск, Ненецкий округ')).toBe('RU-YAN');
    expect(cityFrom('г. Советск, Кировской области')).toBe('Советск');
    expect(cityFrom('Ростовская область')).toBeNull();
  });

  it('телефоны', () => {
    expect(normalizePhone('8 910 466 87 75')).toEqual({ phone: '+7 910 466-87-75', extra: false });
    expect(normalizePhone('79 117 282 363').phone).toBe('+7 911 728-23-63');
    expect(normalizePhone('7-917-957-76-20 \n7-917-128-20-32').extra).toBe(true);
    expect(normalizePhone('').phone).toBeNull();
  });

  it('пометки в скобках и дубли', () => {
    expect(parseName('Роман Дименштейн (правление) ')).toEqual({ fullName: 'Роман Дименштейн', position: null, tags: ['BOARD'] });
    expect(parseName('Иван Петров (директор)')).toEqual({ fullName: 'Иван Петров', position: 'директор', tags: [] });
    const a = { fullName: 'Петров Иван Сергеевич', telegram: null } as never;
    expect(samePerson(a, { fullName: 'Иван Петров', telegram: null })).toBe(true);
    expect(samePerson(a, { fullName: 'Анна Петрова', telegram: null })).toBe(false);
  });
});

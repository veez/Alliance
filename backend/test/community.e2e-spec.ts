import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createApp, login, loginNewCandidate, loginSecretary } from './helpers';

describe('Карта и справочник контактов (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let member: string; // opora (Москва)
  let other: string; // apk (СПб)
  let candidate: string;
  let partner: string;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    member = await login(app, 'opora@alliance.local');
    other = await login(app, 'apk@alliance.local');
    candidate = await loginNewCandidate(app, prisma, 'community');
    partner = await login(app, 'izdat@alliance.local');
  });
  afterAll(() => app.close());

  it('карта: 89 регионов и счётчики по слоям, доступна кандидатам и партнёрам', async () => {
    const res = await http().get('/api/map').set(auth(candidate)).expect(200);
    expect(res.body.regions).toHaveLength(89);
    const msk = res.body.regions.find((r: { code: string }) => r.code === 'RU-MOW');
    expect(msk.members).toBeGreaterThan(0);
    expect(res.body.totals.members).toBe(await prisma.organization.count({ where: { status: 'MEMBER', showOnMap: true } }));
    expect(res.body.totals.candidates).toBeGreaterThan(0);
    await http().get('/api/map').set(auth(partner)).expect(200);
  });

  it('регион: контакты показываются только членам Альянса', async () => {
    const asCandidate = await http().get('/api/map/regions/RU-SPE').set(auth(candidate)).expect(200);
    expect(asCandidate.body.organizations.length).toBeGreaterThan(0);
    expect(asCandidate.body.organizations.every((o: { contacts: unknown }) => o.contacts === null)).toBe(true);
    const asMember = await http().get('/api/map/regions/RU-SPE').set(auth(member)).expect(200);
    expect(asMember.body.organizations[0].contacts.headName).toBeTruthy();
    await http().get('/api/map/regions/RU-XXX').set(auth(member)).expect(404);
  });

  it('организация, скрытая с карты, не учитывается', async () => {
    const org = await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'apk@alliance.local' } } } });
    await http().patch(`/api/organizations/${org.id}`).set(auth(other)).send({ showOnMap: false }).expect(200);
    const res = await http().get('/api/map/regions/RU-SPE').set(auth(member)).expect(200);
    expect(res.body.organizations.some((o: { id: string }) => o.id === org.id)).toBe(false);
    await http().patch(`/api/organizations/${org.id}`).set(auth(other)).send({ showOnMap: true }).expect(200);
  });

  it('справочник: только для членов Альянса и «видящих всё», фильтры', async () => {
    await http().get('/api/contacts/people').set(auth(candidate)).expect(403);
    await http().get('/api/contacts/organizations').set(auth(partner)).expect(403);
    const orgs = await http().get('/api/contacts/organizations?district=Центральный').set(auth(member)).expect(200);
    expect(orgs.body.items.length).toBeGreaterThan(0);
    expect(orgs.body.items.every((o: { region: { district: string } }) => o.region.district === 'Центральный')).toBe(true);
    const people = await http().get('/api/contacts/people?areaCode=DUES').set(auth(member)).expect(200);
    expect(people.body.items.length).toBeGreaterThan(0);
    expect(people.body.items.every((p: { responsibilities: { area: { code: string } }[] }) => p.responsibilities.some((r) => r.area.code === 'DUES'))).toBe(true);
    await http().get('/api/contacts/people').set(auth(await loginSecretary(app))).expect(200);
  });

  it('приватность: скрытые email/телефон и исключение из справочника', async () => {
    const org = await prisma.organization.findFirstOrThrow({ where: { users: { some: { email: 'apk@alliance.local' } } } });
    await http().patch(`/api/organizations/${org.id}`).set(auth(other)).send({ email: 'info@apk.example', phone: '+7 812 000-00-00', contactPrivacy: { hidePhone: true } }).expect(200);
    const emp = await http()
      .post(`/api/organizations/${org.id}/employees`)
      .set(auth(other))
      .send({ fullName: 'Скрытный Сотрудник', email: 'hidden@apk.example', phone: '+7 900 000-00-00', contactPrivacy: { hideEmail: true, hideFromDirectory: true } })
      .expect(201);

    // Другой член Альянса: телефон организации скрыт, сотрудника в справочнике нет
    const card = await http().get(`/api/organizations/${org.id}`).set(auth(member)).expect(200);
    expect(card.body.email).toBe('info@apk.example');
    expect(card.body.phone).toBeNull();
    const dir = await http().get('/api/contacts/organizations?search=АПК').set(auth(member)).expect(200);
    expect(dir.body.items[0].phone).toBeNull();
    const people = await http().get(`/api/contacts/people?organizationId=${org.id}`).set(auth(member)).expect(200);
    expect(people.body.items.some((p: { id: string }) => p.id === emp.body.id)).toBe(false);

    // Своя организация видит всё
    const own = await http().get(`/api/contacts/people?organizationId=${org.id}`).set(auth(other)).expect(200);
    const me = own.body.items.find((p: { id: string }) => p.id === emp.body.id);
    expect(me).toMatchObject({ email: 'hidden@apk.example', hiddenFromDirectory: true });
    const ownCard = await http().get(`/api/organizations/${org.id}`).set(auth(other)).expect(200);
    expect(ownCard.body.phone).toBe('+7 812 000-00-00');
    expect(ownCard.body.contactPrivacy).toMatchObject({ hidePhone: true });

    await http().patch(`/api/organizations/${org.id}/employees/${emp.body.id}`).set(auth(other)).send({ contactPrivacy: { hideEmail: true } }).expect(200);
    const visible = await http().get(`/api/contacts/people?organizationId=${org.id}`).set(auth(member)).expect(200);
    const row = visible.body.items.find((p: { id: string }) => p.id === emp.body.id);
    expect(row).toMatchObject({ email: null, phone: '+7 900 000-00-00' });
  });
});

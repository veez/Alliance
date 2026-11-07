import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { decryptSecret, hashPassword } from '../src/auth/crypto';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEMO_PASSWORD, DEMO_SECRETARY_TOTP } from '../prisma/data/demo';

export { DEMO_PASSWORD, DEMO_SECRETARY_TOTP };

export async function createApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('alliance_refresh='))?.split(';')[0];
}

/** Вход без 2FA (члены, кандидаты, партнёры). */
export async function login(app: INestApplication, email: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200);
  if (res.body.twoFactorRequired) throw new Error(`${email}: требуется 2FA`);
  return res.body.accessToken;
}

/** Вход секретаря с кодом TOTP. */
export async function loginSecretary(app: INestApplication): Promise<string> {
  const step1 = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: 'secretary@alliance.local', password: DEMO_PASSWORD })
    .expect(200);
  const step2 = await request(app.getHttpServer())
    .post('/api/auth/login/2fa')
    .send({ challengeToken: step1.body.challengeToken, code: authenticator.generate(DEMO_SECRETARY_TOTP) })
    .expect(200);
  return step2.body.accessToken;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Вход администратора: при первом вызове включает ему 2FA. */
export async function loginAdminWith2fa(app: INestApplication, prisma: PrismaService): Promise<string> {
  const http = () => request(app.getHttpServer());
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@alliance.local' } });
  if (!user.totpEnabledAt) {
    const token = await login(app, 'admin@alliance.local');
    const setup = await http().post('/api/auth/2fa/setup').set(auth(token)).expect(200);
    await http().post('/api/auth/2fa/enable').set(auth(token)).send({ code: authenticator.generate(setup.body.secret) }).expect(204);
    return token;
  }
  const step1 = await http().post('/api/auth/login').send({ email: 'admin@alliance.local', password: DEMO_PASSWORD }).expect(200);
  const step2 = await http()
    .post('/api/auth/login/2fa')
    .send({ challengeToken: step1.body.challengeToken, code: authenticator.generate(decryptSecret(user.totpSecretEnc!)) })
    .expect(200);
  return step2.body.accessToken;
}

/**
 * Отдельный кандидат для набора тестов. Демо-кандидатов (dvcsp, teplydom) тест голосований
 * принимает в члены, поэтому наборы, которым нужен именно кандидат, создают своего.
 */
export async function loginNewCandidate(app: INestApplication, prisma: PrismaService, key: string): Promise<string> {
  const email = `candidate-${key}@alliance.local`;
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    await prisma.organization.create({
      data: {
        name: `Кандидат для теста ${key}`,
        regionCode: 'RU-OMS',
        status: 'CANDIDATE',
        users: { create: { email, fullName: 'Кандидатова К. К.', status: 'ACTIVE', passwordHash: await hashPassword(DEMO_PASSWORD) } },
      },
    });
  }
  return login(app, email);
}

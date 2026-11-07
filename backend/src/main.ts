import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';

/** Общая настройка приложения — используется и в main, и в интеграционных тестах. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1); // за nginx — реальный IP клиента для rate-limit и аудита
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // inline — для Swagger UI
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: env.appUrl, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  );
}

/** Демо-стенд в одном контейнере: статика фронтенда + возврат index.html для маршрутов SPA. */
function serveFrontend(app: NestExpressApplication) {
  if (!env.staticDir) return;
  const dir = resolve(env.staticDir);
  if (!existsSync(join(dir, 'index.html'))) {
    Logger.warn(`STATIC_DIR=${dir}: index.html не найден`, 'Bootstrap');
    return;
  }
  app.useStaticAssets(dir, { index: false, maxAge: '1h' });
  app.use((req: { method: string; path: string }, res: { sendFile: (p: string) => void }, next: () => void) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(join(dir, 'index.html'));
  });
}

async function bootstrap() {
  process.env.TZ = 'UTC';
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const swagger = new DocumentBuilder()
    .setTitle('Портал Альянса «Ценность каждого» — API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  serveFrontend(app as NestExpressApplication);
  app.enableShutdownHooks();
  await app.listen(env.port);
  Logger.log(`API: http://localhost:${env.port}/api  ·  Swagger: http://localhost:${env.port}/api/docs`, 'Bootstrap');
}

if (require.main === module) void bootstrap();

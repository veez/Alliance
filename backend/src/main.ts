import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';

/** Общая настройка приложения — используется и в main, и в интеграционных тестах. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1); // за nginx — реальный IP клиента для rate-limit и аудита
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.appUrl, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
  );
}

async function bootstrap() {
  process.env.TZ = 'UTC';
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const swagger = new DocumentBuilder()
    .setTitle('Портал Альянса «Ценность каждого» — API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  app.enableShutdownHooks();
  await app.listen(env.port);
  Logger.log(`API: http://localhost:${env.port}/api  ·  Swagger: http://localhost:${env.port}/api/docs`, 'Bootstrap');
}

if (require.main === module) void bootstrap();

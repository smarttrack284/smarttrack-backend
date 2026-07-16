import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication, } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from '#/common/filters/global-filter.filter';
import { ConfigService } from '@nestjs/config';
import { RedisIoAdapter } from '#/common/websockets/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  // Security headers
  await app.register(helmet);

  // Response compression
  await app.register(compress);

  // Cookie support
  await app.register(cookie, {
    secret: process.env.COOKIE_SECRET,
  });

  // Global API prefix
  app.setGlobalPrefix('api');

  // Enable CORS
  app.enableCors({
    origin: process.env.CLIENT_URL ?? true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception handling — normalizes every thrown error into one
  // consistent response shape, must be registered after the pipes above so
  // it can catch ValidationPipe's own BadRequestException too.
  app.useGlobalFilters(new GlobalExceptionFilter());

  const port = Number(process.env.PORT) || 3000;

  const redisIoAdapter = new RedisIoAdapter(app, app.get(ConfigService));
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen({
    port,
    host: '0.0.0.0',
  });

  console.log(`🚀 Server running on http://localhost:${port}/api`);
}

bootstrap();

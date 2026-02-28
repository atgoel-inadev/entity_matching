import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TimingInterceptor } from './common/interceptors/timing.interceptor';
import { SnakeCaseResponseInterceptor } from './common/interceptors/snake-case-response.interceptor';

const logger = new Logger('Bootstrap');

/**
 * Bootstraps the ResolveIQ NestJS application on the Fastify HTTP adapter.
 * Sets up global validation, Swagger documentation, and starts listening on
 * the configured port.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 8001);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // CORS — allow the React UI (default Vite dev server on any port)
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Correlation-Id', 'Authorization'],
    credentials: true,
  });

  // Global exception filter — maps domain errors to HTTP status codes
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global interceptors — logging, timing, and snake_case response transformation
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TimingInterceptor(),
    new SnakeCaseResponseInterceptor(),
  );

  // Global validation pipe — whitelist unknown fields but do NOT forbid them,
  // so the UI can send snake_case aliases (e.g. create_if_missing) which are
  // handled by @Transform decorators before being stripped by whitelist.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger API documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ResolveIQ v2')
    .setDescription(
      'Configuration-driven entity resolution engine. ' +
        'Supports EXACT, FUZZY, PHONETIC, NUMERIC, SEMANTIC, and HYBRID matching strategies.',
    )
    .setVersion('2.0.0')
    .addTag('Profiles', 'Manage resolution profiles and field configurations')
    .addTag('Resolution', 'Resolve entities against a profile')
    .addTag('Entities', 'Manage entities within a profile')
    .addTag('Health', 'System health and metrics')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'apiKey')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  await app.listen(port, '0.0.0.0');

  logger.log(`ResolveIQ v2 running on port ${port} [${nodeEnv}]`);
  logger.log(`Swagger docs: http://localhost:${port}/api`);
}

bootstrap().catch((error: unknown) => {
  logger.error('Failed to start application', error);
  process.exit(1);
});

import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { validationPipeOptions } from './common/validation.js';
import { env } from './config/env.js';

/** Prefixo global da API — todo endpoint do produto vive sob ele. */
export const API_PREFIX = 'api/v1';

/** Caminho da interface do Swagger e do documento OpenAPI em JSON. */
export const SWAGGER_PATH = 'docs';
export const SWAGGER_JSON_PATH = 'docs-json';

/**
 * Aplica a configuração HTTP da API na aplicação NestJS.
 *
 * `main.ts` e os testes e2e chamam esta mesma função — assim o que é testado
 * é exatamente o que roda em produção.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = env();

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
  app.use(cookieParser());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('NetProfissionais — Gerenciador de Leads')
      .setDescription(
        'API do MVP 1: autenticação, dashboards por perfil, pool de leads, funil de vendas e gestão de usuários.',
      )
      .setVersion('v1')
      .addTag('health', 'Sonda de saúde da API')
      .build(),
  );

  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    // O documento já sai com o prefixo (`/api/v1/...`) porque o explorador
    // lê as rotas resolvidas pelo app. `useGlobalPrefix` ficaria ligado só
    // para montar o prefixo do caminho do próprio Swagger.
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    customSiteTitle: 'NetProfissionais — API',
  });

  return app;
}

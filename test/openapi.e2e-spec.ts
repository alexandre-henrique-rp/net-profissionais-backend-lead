import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Documento OpenAPI (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs-json devolve o documento OpenAPI com os caminhos reais @spec:AC-011', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);

    expect(response.body.openapi).toMatch(/^3\./);
    expect(Object.keys(response.body.paths)).toContain('/api/v1/health');
    expect(response.body.info.title).toContain('NetProfissionais');
  });

  it('GET /docs responde com a interface do Swagger @spec:AC-012', async () => {
    const response = await request(app.getHttpServer()).get('/docs').expect(200);

    expect(response.text.toLowerCase()).toContain('swagger');
  });
});

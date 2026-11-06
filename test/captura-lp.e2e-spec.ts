import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  CAPTURA_CONFIG,
  CAPTURA_FETCH,
  type CapturaFetch,
  type ConfiguracaoCaptura,
} from '../src/captura-lp/webhook-relay.service.js';

/** Corporação de teste. */
const TENANT = '1209f89d-8328-80f5-8008-d08667c53da5';

/** Segredo de teste — nunca é o token de verdade. */
const SEGREDO = 'whsec_teste_e2e_relay';

/** Corpo que a landing page entrega. */
const LEAD = {
  lead: {
    document: '11222333000181',
    company_name: 'Teste Integracao Externa',
    contacts: [
      {
        name: 'Ana Souza',
        role: 'Compras',
        phone: '31999998888',
        email: 'ana@exemplo.com.br',
      },
    ],
  },
  lgpd_consent: true,
  consent_at: '2026-11-06T14:30:00.000Z',
  source: 'landing_page',
};

/** Transporta as entregas ao webhook sem sair do processo. */
function transporteFalso(): { fn: CapturaFetch; corpos: string[] } {
  const corpos: string[] = [];

  const fn: CapturaFetch = async (_url, init) => {
    corpos.push(init.body);

    return {
      status: 201,
      text: async () =>
        JSON.stringify({
          success: true,
          data: {
            tenant_lead_id: 'lead-op-1',
            lead_id: 'lead-1',
            duplicate: false,
          },
        }),
    };
  };

  return { fn, corpos };
}

describe('API (e2e) — captura da landing page', () => {
  let app: INestApplication<App>;
  const transporte = transporteFalso();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CAPTURA_FETCH)
      .useValue(transporte.fn)
      .overrideProvider(CAPTURA_CONFIG)
      .useValue({
        token: SEGREDO,
        tenantId: TENANT,
        apiBase: 'http://api.test/api/v1',
      } satisfies ConfiguracaoCaptura)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC-224: entrega o lead sem cookie e sem token de usuário @spec:AC-224', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/captura/leads')
      .set('CF-Connecting-IP', '198.51.100.10')
      .send(LEAD)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      tenant_lead_id: 'lead-op-1',
      lead_id: 'lead-1',
      duplicate: false,
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('AC-237: o corpo entregue chega no contrato do webhook @spec:AC-237', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/captura/leads')
      .set('CF-Connecting-IP', '198.51.100.11')
      .send(LEAD)
      .expect(201);

    const corpo = JSON.parse(transporte.corpos[transporte.corpos.length - 1]);

    expect(corpo.lead.document).toBe('11222333000181');
    expect(corpo.lead.contacts[0].name).toBe('Ana Souza');
    expect(corpo.lgpd_consent).toBe(true);
    expect(corpo.source).toBe('landing_page');
  });

  it('AC-230: lead sem consentimento LGPD é recusado @spec:AC-230', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/captura/leads')
      .set('CF-Connecting-IP', '198.51.100.12')
      .send({ ...LEAD, lgpd_consent: false })
      .expect(422);

    expect(response.body.error.code).toBe('LGPD_CONSENT_REQUIRED');
  });

  it('AC-236: excesso de entregas da mesma origem é barrado com 429 @spec:AC-236', async () => {
    const origem = '198.51.100.99';

    for (let tentativa = 1; tentativa <= 20; tentativa += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/captura/leads')
        .set('CF-Connecting-IP', origem)
        .send(LEAD)
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/captura/leads')
      .set('CF-Connecting-IP', origem)
      .send(LEAD)
      .expect(429);

    expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('API (e2e) — captura sem configuração', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CAPTURA_FETCH)
      .useValue(transporteFalso().fn)
      .overrideProvider(CAPTURA_CONFIG)
      .useValue({ token: undefined, tenantId: undefined, apiBase: 'http://api.test/api/v1' })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC-225: sem segredo no ambiente a rota recusa com erro de configuração @spec:AC-225', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/captura/leads')
      .set('CF-Connecting-IP', '198.51.100.20')
      .send(LEAD)
      .expect(503);

    expect(response.body.error.code).toBe('CAPTURA_NAO_CONFIGURADA');
  });
});

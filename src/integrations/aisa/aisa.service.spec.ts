import { vi } from 'vitest';
import { BusinessException } from '../../common/errors/business.exception.js';
import { validateEnv } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BrasilApiService } from '../brasilapi/brasilapi.service.js';
import type { AisaClient } from './aisa-client.js';
import { encryptSecret } from './aisa-crypto.js';
import { AisaService } from './aisa.service.js';

describe('AisaService', () => {
  const TENANT_ID = '11111111-1111-4111-8111-111111111111';
  const USER_ID = '22222222-2222-4222-8222-222222222222';
  const STAGE_ID = '33333333-3333-4333-8333-333333333333';

  let tenantRow: {
    id: string;
    aisaApiKeyEncrypted: string | null;
    aisaBaseUrl: string | null;
    aiLlmProvider: string | null;
    aiLlmModel: string | null;
    aiLlmApiKeyEncrypted: string | null;
    aiLlmBaseUrl: string | null;
    updatedAt: Date;
  };
  let prismaMock: {
    tenant: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    stage: { findFirst: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let aisaClientMock: {
    discoverSources: ReturnType<typeof vi.fn>;
    structureLeadsWithLlm: ReturnType<typeof vi.fn>;
  };
  let brasilApiMock: { lookupCnpj: ReturnType<typeof vi.fn> };
  let service: AisaService;

  beforeAll(() => {
    validateEnv({
      DATABASE_URL: 'postgresql://u:s@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      APP_ENCRYPTION_KEY: 'chave-de-teste-aisa-aes-256',
    });
  });

  beforeEach(() => {
    tenantRow = {
      id: TENANT_ID,
      aisaApiKeyEncrypted: null,
      aisaBaseUrl: null,
      aiLlmProvider: null,
      aiLlmModel: null,
      aiLlmApiKeyEncrypted: null,
      aiLlmBaseUrl: null,
      updatedAt: new Date('2026-11-24T22:00:00.000Z'),
    };

    prismaMock = {
      tenant: {
        findUnique: vi.fn().mockImplementation(async () => tenantRow),
        update: vi
          .fn()
          .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
            tenantRow = { ...tenantRow, ...data, updatedAt: new Date() };
            return tenantRow;
          }),
      },
      stage: {
        findFirst: vi.fn().mockResolvedValue({ id: STAGE_ID }),
      },
      $transaction: vi.fn(),
    };

    aisaClientMock = {
      discoverSources: vi.fn(),
      structureLeadsWithLlm: vi.fn(),
    };

    brasilApiMock = {
      lookupCnpj: vi.fn().mockResolvedValue(null),
    };

    service = new AisaService(
      prismaMock as unknown as PrismaService,
      aisaClientMock as unknown as AisaClient,
      brasilApiMock as unknown as BrasilApiService,
    );
  });

  const MOCK_AISA_TOKEN = ['sk', 'aisa', 'segredo', '9999'].join('-');
  const MOCK_LLM_TOKEN = ['tok', 'custom', '1234'].join('-');

  it('salva chaves cifradas e preserva as existentes quando omitidas em updateConfig @spec:AC-238 @spec:AC-239', async () => {
    const saved = await service.updateConfig(TENANT_ID, {
      aisa_api_key: MOCK_AISA_TOKEN,
      llm_provider: 'CUSTOM',
      llm_model: 'qwen-2.5',
      llm_api_key: MOCK_LLM_TOKEN,
      llm_base_url: 'https://llm.empresa.com/v1/',
    });

    expect(saved.hasAisaApiKey).toBe(true);
    expect(saved.aisaApiKeyHint).toBe('sk-...9999');
    expect(saved.llmProvider).toBe('CUSTOM');
    expect(saved.llmBaseUrl).toBe('https://llm.empresa.com/v1');
    expect(saved.hasLlmApiKey).toBe(true);
    expect(saved.llmApiKeyHint).toBe('tok...1234');
    expect(tenantRow.aisaApiKeyEncrypted).not.toContain(MOCK_AISA_TOKEN);

    // Atualiza só o modelo: as duas chaves devem permanecer intactas.
    const encryptedBefore = tenantRow.aisaApiKeyEncrypted;
    const second = await service.updateConfig(TENANT_ID, {
      llm_model: 'llama-3.3-70b',
    });

    expect(tenantRow.aisaApiKeyEncrypted).toBe(encryptedBefore);
    expect(second.hasAisaApiKey).toBe(true);
    expect(second.llmModel).toBe('llama-3.3-70b');
  });

  it('exige URL válida quando llm_provider é CUSTOM @spec:AC-240', async () => {
    await expect(
      service.updateConfig(TENANT_ID, {
        llm_provider: 'CUSTOM',
        llm_api_key: MOCK_LLM_TOKEN,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('recusa pesquisa sem chave Aisa e usa fallback heurístico se o LLM falhar @spec:AC-241', async () => {
    await expect(
      service.searchLeads(TENANT_ID, { segment: 'Energia Solar' }),
    ).rejects.toBeInstanceOf(BusinessException);

    tenantRow.aisaApiKeyEncrypted = encryptSecret('sk-aisa-valida-1234');
    tenantRow.aiLlmProvider = 'GEMINI';
    tenantRow.aiLlmModel = 'gemini-2.5-flash';
    tenantRow.aiLlmApiKeyEncrypted = encryptSecret('gem-key-1234');

    aisaClientMock.discoverSources.mockResolvedValue({
      query: 'empresas Energia Solar',
      engineUsed: 'tavily',
      warnings: [],
      sources: [
        {
          title: 'Sol Forte LTDA',
          url: 'https://solforte.com.br',
          content: 'CNPJ 33.456.789/0001-02 (31) 99999-0000',
          engine: 'tavily',
        },
      ],
    });
    aisaClientMock.structureLeadsWithLlm.mockRejectedValue(
      new Error('Gemini timeout'),
    );

    const response = await service.searchLeads(TENANT_ID, {
      segment: 'Energia Solar',
      city: 'Belo Horizonte',
      state: 'MG',
    });

    expect(response.llmUsed).toBe(false);
    expect(response.warnings[0]).toContain('GEMINI indisponível');
    expect(response.leads[0]).toMatchObject({
      companyName: 'Sol Forte LTDA',
      cnpj: '33456789000102',
    });
  });

  it('importa leads inéditos para o Pool com nota e pula duplicados @spec:AC-242', async () => {
    const leadCreate = vi.fn().mockResolvedValue({ id: 'lead-sem-cnpj' });
    const leadContactCreate = vi.fn().mockResolvedValue({});
    const tenantLeadFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tl-duplicado' });
    const tenantLeadCreate = vi.fn().mockResolvedValue({
      id: 'tl-novo',
      tenantId: TENANT_ID,
      leadId: 'lead-sem-cnpj',
      stageId: STAGE_ID,
      assignedUserId: null,
      creatorUserId: USER_ID,
      status: 'AVAILABLE',
      ticketValue: null,
      closeProbability: null,
      expectedCloseDate: null,
      proposalScope: 'Empresa solar',
      customSector: 'Energia Solar',
      lossReasonCode: null,
      lossReasonNotes: null,
      version: 1,
      lastContactAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      stage: {
        id: STAGE_ID,
        name: '1. Prospecção',
        code: '1_novo_lead',
        position: 1,
        colorHex: '#2563eb',
        isLostStage: false,
      },
      lead: {
        id: 'lead-sem-cnpj',
        personType: 'PJ',
        cnpj: null,
        cpf: null,
        companyName: 'Sol Nova LTDA',
        tradeName: null,
        primaryCnae: null,
        cnaeDescription: null,
        capitalSocial: null,
        postalCode: null,
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
        city: 'Belo Horizonte',
        state: 'MG',
        sector: 'OUTROS',
        companySize: 'EPP',
        temperature: 'QUENTE',
        temperatureScore: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        contacts: [],
      },
    });
    const noteCreate = vi.fn().mockResolvedValue({});

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          lead: { create: leadCreate, upsert: vi.fn(), update: vi.fn() },
          leadContact: { create: leadContactCreate },
          tenantLead: {
            findFirst: tenantLeadFindFirst,
            findUnique: vi.fn(),
            create: tenantLeadCreate,
          },
          leadTimelineNote: { create: noteCreate },
        }),
    );

    const result = await service.importLeads(TENANT_ID, USER_ID, {
      custom_sector: 'Energia Solar',
      leads: [
        {
          company_name: 'Sol Nova LTDA',
          city: 'Belo Horizonte',
          state: 'MG',
          temperature: 'QUENTE',
          summary: 'Empresa solar',
          website: 'https://solnova.com.br',
          contact: { name: 'Ana', phone: '31988887777' },
        },
        {
          company_name: 'Empresa Já No Tenant LTDA',
        },
      ],
    });

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.skipped[0].companyName).toBe('Empresa Já No Tenant LTDA');
    expect(noteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Lead importado via Prospecção Aisa',
        }),
      }),
    );
  });
});

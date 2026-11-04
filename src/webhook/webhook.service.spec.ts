import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  LeadTimelineNoteType,
  PersonType,
  TenantLeadStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RedisLike } from '../redis/redis.service.js';
import { WebhookLeadPayloadDto } from './dto/webhook-payload.dto.js';
import {
  WEBHOOK_IDEMPOTENCY_PREFIX,
  WEBHOOK_IDEMPOTENCY_TTL,
} from './webhook.constants.js';
import { computeSignature } from './webhook.signature.js';
import { WebhookService, type WebhookIngestInput } from './webhook.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OUTRO_TENANT_ID = '99999999-9999-4999-8999-999999999999';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_LEAD_ID = '33333333-3333-4333-8333-333333333333';
const STAGE_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';
const SEGREDO = 'whsec_teste_eletrominas_2026';
const CNPJ = '12345678000190';

/**
 * Escalares do `Lead` que o `upsert` devolve (`select` do service).
 *
 * `null` = campo ainda vazio: é o que o `fillOnlyPatch` pode preencher.
 */
const CAMPOS_DO_LEAD_VAZIOS = {
  companyName: null,
  tradeName: null,
  postalCode: null,
  street: null,
  number: null,
  complement: null,
  neighborhood: null,
  city: null,
  state: null,
};

/** Dublê em memória do cliente Redis (idempotência). */
class RedisFake implements RedisLike {
  readonly store = new Map<string, string>();
  readonly chamadas: Array<{ metodo: string; args: unknown[] }> = [];

  async set(key: string, value: string, mode: 'EX', ttl: number): Promise<'OK'> {
    this.chamadas.push({ metodo: 'set', args: [key, value, mode, ttl] });
    this.store.set(key, value);

    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.chamadas.push({ metodo: 'get', args: [key] });

    return this.store.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    this.chamadas.push({ metodo: 'del', args: [key] });

    return this.store.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    this.chamadas.push({ metodo: 'incr', args: [key] });
    const total = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(total));

    return total;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.chamadas.push({ metodo: 'expire', args: [key, seconds] });

    return 1;
  }

  disconnect(): void {
    this.chamadas.push({ metodo: 'disconnect', args: [] });
  }
}

/** Cliente de transação fake: é o objeto que o `$transaction` entrega ao service. */
function criarTxFake() {
  return {
    lead: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    tenantLead: { findUnique: vi.fn(), create: vi.fn() },
    stage: { findFirst: vi.fn() },
    leadContact: { createMany: vi.fn() },
    user: { findFirst: vi.fn() },
    leadTimelineNote: { create: vi.fn() },
  };
}

type TxFake = ReturnType<typeof criarTxFake>;

/** Payload do contrato com os valores do caso feliz. */
function payloadValido(extra: Record<string, unknown> = {}): WebhookLeadPayloadDto {
  return {
    lgpd_consent: true,
    source: 'google_ads',
    consent_at: '2026-10-23T14:30:00Z',
    lead: {
      document: '12.345.678/0001-90',
      company_name: 'Eletro Minas Distribuidora LTDA',
      trade_name: 'Eletro Minas',
      message: 'Preciso de cotação para cabo flexível 16mm.',
      contacts: [
        {
          name: 'Carlos Alberto de Souza',
          role: 'Gerente de Suprimentos',
          phone: '(11) 98765-4321',
          email: 'Carlos.Compras@EletroMinas.com.br',
          is_primary: true,
          is_decision_maker: true,
        },
      ],
      address: {
        postal_code: '01310-100',
        street: 'Avenida Paulista',
        number: '1000',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'sp',
      },
    },
    ...extra,
  } as WebhookLeadPayloadDto;
}

/** Entrada do `ingest` com assinatura HMAC válida sobre o corpo serializado. */
function entrada(
  payload: WebhookLeadPayloadDto,
  extra: Partial<WebhookIngestInput> = {},
): WebhookIngestInput {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

  return {
    tenantId: TENANT_ID,
    payload,
    rawBody,
    signature: `sha256=${computeSignature(rawBody, SEGREDO)}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...extra,
  };
}

/** Asserção de erro de negócio: status HTTP + código de contrato. */
async function expectBusinessError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(BusinessException);
  expect((error as BusinessException).getStatus()).toBe(status);
  expect((error as BusinessException).code).toBe(code);
}

describe('WebhookService', () => {
  let tx: TxFake;
  let redis: RedisFake;
  let prisma: {
    tenant: { findUnique: ReturnType<typeof vi.fn> };
    lead: { findUnique: ReturnType<typeof vi.fn> };
    tenantLead: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: WebhookService;

  beforeEach(() => {
    tx = criarTxFake();
    redis = new RedisFake();
    prisma = {
      tenant: { findUnique: vi.fn() },
      lead: { findUnique: vi.fn() },
      tenantLead: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: TxFake) => Promise<unknown>) => callback(tx),
    );

    service = new WebhookService(prisma as unknown as PrismaService, redis);
  });

  /** Cenário de lead novo: identidade, primeira etapa, contatos e nota. */
  function prepararLeadNovo(): void {
    prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
    tx.lead.findUnique.mockResolvedValue(null);
    tx.stage.findFirst.mockResolvedValue({ id: STAGE_ID });
    tx.lead.upsert.mockResolvedValue({ id: LEAD_ID, ...CAMPOS_DO_LEAD_VAZIOS });
    tx.lead.update.mockResolvedValue({});
    tx.leadContact.createMany.mockResolvedValue({ count: 1 });
    // Chamado duas vezes: checagem antecipada de duplicata e checagem de corrida.
    tx.tenantLead.findUnique.mockResolvedValue(null);
    tx.tenantLead.create.mockResolvedValue({ id: TENANT_LEAD_ID });
    tx.user.findFirst.mockResolvedValue({ id: USER_ID });
    tx.leadTimelineNote.create.mockResolvedValue({ id: 'nota-1' });
  }

  describe('corporação do webhook', () => {
    it('responde 404 quando o tenant não existe, sem gravar nada', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expectBusinessError(service.ingest(entrada(payloadValido())), 404, 'NOT_FOUND');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.lead.upsert).not.toHaveBeenCalled();
    });

    it('trata id fora do formato UUID como tenant inexistente (404, não 500)', async () => {
      await expectBusinessError(
        service.ingest(entrada(payloadValido(), { tenantId: 'nao-e-uuid' })),
        404,
        'NOT_FOUND',
      );

      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('assinatura HMAC', () => {
    it('responde 401 INVALID_SIGNATURE sem nenhuma escrita no Prisma @spec:AC-107', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      const payload = payloadValido();
      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

      await expectBusinessError(
        service.ingest({
          tenantId: TENANT_ID,
          payload,
          rawBody,
          signature: `sha256=${computeSignature(rawBody, 'segredo-de-outra-corporacao')}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
        }),
        401,
        'INVALID_SIGNATURE',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.lead.upsert).not.toHaveBeenCalled();
      expect(tx.tenantLead.create).not.toHaveBeenCalled();
      expect(tx.leadContact.createMany).not.toHaveBeenCalled();
    });

    it('responde 401 para reenvio com X-Timestamp fora da janela de 5 minutos @spec:AC-109', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });

      await expectBusinessError(
        service.ingest(
          entrada(payloadValido(), {
            timestamp: String(Math.floor(Date.now() / 1000) - 6 * 60),
          }),
        ),
        401,
        'INVALID_SIGNATURE',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('valida a assinatura antes do consentimento LGPD (401, não 422)', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      const payload = payloadValido({ lgpd_consent: false });

      await expectBusinessError(
        service.ingest(entrada(payload, { signature: 'sha256=deadbeef' })),
        401,
        'INVALID_SIGNATURE',
      );
    });
  });

  describe('consentimento LGPD', () => {
    it('responde 422 LGPD_CONSENT_REQUIRED quando lgpd_consent é false, sem gravar @spec:AC-110', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });

      await expectBusinessError(
        service.ingest(entrada(payloadValido({ lgpd_consent: false }))),
        422,
        'LGPD_CONSENT_REQUIRED',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.lead.upsert).not.toHaveBeenCalled();
    });

    it('responde 422 LGPD_CONSENT_REQUIRED quando lgpd_consent está ausente', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      const payload = payloadValido();
      delete (payload as { lgpd_consent?: boolean }).lgpd_consent;

      await expectBusinessError(
        service.ingest(entrada(payload)),
        422,
        'LGPD_CONSENT_REQUIRED',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('o DTO não decide o consentimento: payload sem lgpd_consent passa e o 422 vem do service', async () => {
      const payload = payloadValido();
      delete (payload as { lgpd_consent?: boolean }).lgpd_consent;

      const dto = plainToInstance(WebhookLeadPayloadDto, payload);
      const erros = await validate(dto);

      expect(erros).toHaveLength(0);
    });

    it('o DTO recusa lgpd_consent que não é booleano', async () => {
      const dto = plainToInstance(
        WebhookLeadPayloadDto,
        payloadValido({ lgpd_consent: 'true' }),
      );
      const erros = await validate(dto);

      expect(erros.map((erro) => erro.property)).toContain('lgpd_consent');
    });
  });

  describe('captação de lead novo', () => {
    it('cria Lead, oportunidade no Pool, contatos e nota dentro de $transaction @spec:AC-111', async () => {
      prepararLeadNovo();

      const resultado = await service.ingest(entrada(payloadValido()));

      expect(resultado).toEqual({
        tenant_lead_id: TENANT_LEAD_ID,
        lead_id: LEAD_ID,
        duplicate: false,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Identidade global: upsert pelo documento (CNPJ só com dígitos).
      expect(tx.lead.upsert).toHaveBeenCalledWith({
        where: { cnpj: CNPJ },
        create: {
          personType: PersonType.PJ,
          cnpj: CNPJ,
          cpf: null,
          companyName: 'Eletro Minas Distribuidora LTDA',
          tradeName: 'Eletro Minas',
          postalCode: '01310-100',
          street: 'Avenida Paulista',
          number: '1000',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
        },
        update: {},
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          postalCode: true,
          street: true,
          number: true,
          complement: true,
          neighborhood: true,
          city: true,
          state: true,
        },
      });

      // Qualificação só dos campos vazios.
      expect(tx.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD_ID },
        data: {
          companyName: 'Eletro Minas Distribuidora LTDA',
          tradeName: 'Eletro Minas',
          postalCode: '01310-100',
          street: 'Avenida Paulista',
          number: '1000',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
        },
      });

      // Primeira etapa do funil, disponível no Pool.
      expect(tx.stage.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      expect(tx.tenantLead.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          leadId: LEAD_ID,
          stageId: STAGE_ID,
          status: TenantLeadStatus.AVAILABLE,
          assignedUserId: null,
          creatorUserId: null,
        },
        select: { id: true },
      });

      // Nota de recebimento assinada por um usuário do tenant.
      expect(tx.leadTimelineNote.create).toHaveBeenCalledWith({
        data: {
          tenantLeadId: TENANT_LEAD_ID,
          userId: USER_ID,
          type: LeadTimelineNoteType.NOTE,
          title: 'Lead recebido via webhook',
          content:
            'Origem: google_ads · consentimento LGPD em 2026-10-23T14:30:00Z · Preciso de cotação para cabo flexível 16mm.',
        },
      });

      // Tudo passou pelo cliente de transação, nada pelo cliente raiz.
      expect(prisma.lead.findUnique).not.toHaveBeenCalled();
      expect(prisma.tenantLead.findUnique).not.toHaveBeenCalled();
    });

    it('grava cada contato do payload com o tenantId do webhook, sem copiar contato de outro tenant', async () => {
      prepararLeadNovo();
      const payload = payloadValido();
      payload.lead.contacts = [
        {
          name: '  Carlos Alberto de Souza  ',
          role: 'Gerente de Suprimentos',
          phone: '(11) 98765-4321',
          email: 'Carlos.Compras@EletroMinas.com.br',
          is_primary: true,
          is_decision_maker: true,
        },
        { name: 'Marina Lopes', phone: '11 3333-4444' },
      ];

      await service.ingest(entrada(payload));

      const contatos = tx.leadContact.createMany.mock.calls[0][0].data as Array<
        Record<string, unknown>
      >;

      expect(contatos).toHaveLength(2);
      expect(contatos.every((contato) => contato.tenantId === TENANT_ID)).toBe(true);
      expect(contatos.every((contato) => contato.tenantId !== OUTRO_TENANT_ID)).toBe(true);
      expect(contatos[0]).toEqual({
        tenantId: TENANT_ID,
        leadId: LEAD_ID,
        name: 'Carlos Alberto de Souza',
        role: 'Gerente de Suprimentos',
        phone: '11987654321',
        email: 'carlos.compras@eletrominas.com.br',
        birthday: null,
        isPrimary: true,
        isDecisionMaker: true,
      });
      expect(contatos[1]).toMatchObject({
        tenantId: TENANT_ID,
        name: 'Marina Lopes',
        phone: '1133334444',
        email: null,
        isPrimary: false,
        isDecisionMaker: false,
      });
    });

    it('aceita CPF de 11 dígitos e faz upsert por cpf como pessoa física', async () => {
      prepararLeadNovo();
      const payload = payloadValido();
      payload.lead.document = '123.456.789-00';

      await service.ingest(entrada(payload));

      expect(tx.lead.upsert.mock.calls[0][0]).toMatchObject({
        where: { cpf: '12345678900' },
        create: { personType: PersonType.PF, cnpj: null, cpf: '12345678900' },
      });
    });

    it('recusa documento que não é CNPJ nem CPF com 400 e sem escrita', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      const payload = payloadValido();
      payload.lead.document = '123';

      await expectBusinessError(
        service.ingest(entrada(payload)),
        400,
        'VALIDATION_ERROR',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa person_type divergente do documento com 400', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      const payload = payloadValido();
      payload.lead.document = '123.456.789-00';
      payload.lead.person_type = PersonType.PJ;

      await expectBusinessError(
        service.ingest(entrada(payload)),
        400,
        'VALIDATION_ERROR',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('responde 422 quando o tenant ainda não tem etapas no funil', async () => {
      prepararLeadNovo();
      tx.stage.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.ingest(entrada(payloadValido())),
        422,
        'UNPROCESSABLE_ENTITY',
      );

      expect(tx.lead.upsert).not.toHaveBeenCalled();
    });

    it('quando o tenant não tem usuário, o lead entra e a nota é omitida', async () => {
      prepararLeadNovo();
      tx.user.findFirst.mockResolvedValue(null);

      const resultado = await service.ingest(entrada(payloadValido()));

      expect(resultado).toEqual({
        tenant_lead_id: TENANT_LEAD_ID,
        lead_id: LEAD_ID,
        duplicate: false,
      });
      expect(tx.tenantLead.create).toHaveBeenCalledTimes(1);
      // `LeadTimelineNote.userId` é NOT NULL: sem autor, não há nota.
      expect(tx.leadTimelineNote.create).not.toHaveBeenCalled();
    });
  });

  describe('idempotência', () => {
    it('a mesma Idempotency-Key não cria outro lead na segunda chamada @spec:AC-112', async () => {
      prepararLeadNovo();
      const payload = payloadValido();
      const chave = 'idem-eletrominas-0001';

      const primeira = await service.ingest(entrada(payload, { idempotencyKey: chave }));
      const segunda = await service.ingest(entrada(payload, { idempotencyKey: chave }));

      expect(primeira).toEqual({
        tenant_lead_id: TENANT_LEAD_ID,
        lead_id: LEAD_ID,
        duplicate: false,
      });
      expect(segunda).toEqual({
        tenant_lead_id: TENANT_LEAD_ID,
        lead_id: LEAD_ID,
        duplicate: true,
      });

      // A segunda chamada parou no cache: nenhuma transação nova.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.lead.upsert).toHaveBeenCalledTimes(1);
      expect(tx.tenantLead.create).toHaveBeenCalledTimes(1);
    });

    it('grava a resposta no Redis por 24 horas com a chave do tenant', async () => {
      prepararLeadNovo();
      const chave = 'idem-eletrominas-0002';

      await service.ingest(entrada(payloadValido(), { idempotencyKey: chave }));

      expect(redis.chamadas).toContainEqual({
        metodo: 'set',
        args: [
          `${WEBHOOK_IDEMPOTENCY_PREFIX}${TENANT_ID}:${chave}`,
          JSON.stringify({
            tenant_lead_id: TENANT_LEAD_ID,
            lead_id: LEAD_ID,
            duplicate: false,
          }),
          'EX',
          WEBHOOK_IDEMPOTENCY_TTL,
        ],
      });
      expect(WEBHOOK_IDEMPOTENCY_TTL).toBe(24 * 60 * 60);
    });

    it('sem Redis a captação continua funcionando (perde só a idempotência)', async () => {
      prepararLeadNovo();
      const semRedis = new WebhookService(prisma as unknown as PrismaService);

      const resultado = await semRedis.ingest(
        entrada(payloadValido(), { idempotencyKey: 'idem-sem-redis' }),
      );

      expect(resultado.duplicate).toBe(false);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('documento repetido no mesmo tenant responde duplicate: true (não é erro)', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      tx.lead.findUnique.mockResolvedValue({ id: LEAD_ID });
      tx.tenantLead.findUnique.mockResolvedValue({ id: TENANT_LEAD_ID });

      const resultado = await service.ingest(entrada(payloadValido()));

      expect(resultado).toEqual({
        tenant_lead_id: TENANT_LEAD_ID,
        lead_id: LEAD_ID,
        duplicate: true,
      });
      // Reenvio não pode duplicar contatos nem oportunidade.
      expect(tx.lead.upsert).not.toHaveBeenCalled();
      expect(tx.leadContact.createMany).not.toHaveBeenCalled();
      expect(tx.tenantLead.create).not.toHaveBeenCalled();
      expect(tx.leadTimelineNote.create).not.toHaveBeenCalled();
    });
  });

  describe('identidade global compartilhada entre tenants', () => {
    it('reaproveita o Lead de outro tenant sem sobrescrever campo preenchido nem copiar contatos @spec:AC-113', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ webhookToken: SEGREDO });
      // O Lead existe (outra corporação já cadastrou o mesmo CNPJ)…
      tx.lead.findUnique.mockResolvedValue({ id: LEAD_ID });
      // …mas a oportunidade neste tenant ainda não.
      tx.tenantLead.findUnique.mockResolvedValue(null);
      tx.stage.findFirst.mockResolvedValue({ id: STAGE_ID });
      // Dado já qualificado por quem cadastrou primeiro.
      tx.lead.upsert.mockResolvedValue({
        id: LEAD_ID,
        ...CAMPOS_DO_LEAD_VAZIOS,
        companyName: 'Razão Social Qualificada Pelo Outro Tenant',
        city: 'Belo Horizonte',
      });
      tx.lead.update.mockResolvedValue({});
      tx.leadContact.createMany.mockResolvedValue({ count: 1 });
      tx.tenantLead.create.mockResolvedValue({ id: TENANT_LEAD_ID });
      tx.user.findFirst.mockResolvedValue({ id: USER_ID });
      tx.leadTimelineNote.create.mockResolvedValue({ id: 'nota-1' });

      const resultado = await service.ingest(entrada(payloadValido()));

      expect(resultado).toEqual({
        tenant_lead_id: TENANT_LEAD_ID,
        lead_id: LEAD_ID,
        duplicate: false,
      });

      // O upsert não altera nada: a qualificação é feita campo vazio por campo.
      expect(tx.lead.upsert.mock.calls[0][0]).toMatchObject({
        where: { cnpj: CNPJ },
        update: {},
      });

      // Razão social e cidade já estavam preenchidas → não são sobrescritas.
      const patch = tx.lead.update.mock.calls[0][0].data as Record<string, unknown>;
      expect(patch).not.toHaveProperty('companyName');
      expect(patch).not.toHaveProperty('city');
      expect(patch).toEqual({
        tradeName: 'Eletro Minas',
        postalCode: '01310-100',
        street: 'Avenida Paulista',
        number: '1000',
        neighborhood: 'Bela Vista',
        state: 'SP',
      });

      // Só os contatos que vieram neste payload, todos no tenant do webhook.
      const contatos = tx.leadContact.createMany.mock.calls[0][0].data as Array<
        Record<string, unknown>
      >;
      expect(contatos).toHaveLength(1);
      expect(contatos[0]).toMatchObject({
        tenantId: TENANT_ID,
        leadId: LEAD_ID,
        name: 'Carlos Alberto de Souza',
      });
    });
  });
});

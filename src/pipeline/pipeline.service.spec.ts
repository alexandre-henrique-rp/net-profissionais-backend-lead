import 'reflect-metadata';
import {
  BadRequestException,
  ValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types.js';
import { BusinessException } from '../common/errors/business.exception.js';
import { validationPipeOptions } from '../common/validation.js';
import { Prisma, type TenantLeadStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CommercialTermsDto } from './dto/commercial-terms.dto.js';
import { MoveStageDto } from './dto/move-stage.dto.js';
import { PipelineEventsService, type PipelineLeadMovedEvent } from './pipeline-events.service.js';
import { PipelineService } from './pipeline.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_USER_ID = '77777777-7777-4777-8777-777777777777';
const LEAD_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_LEAD_ID = '55555555-5555-4555-8555-555555555555';
const STAGE_NEW_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const STAGE_QUAL_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAGE_PROPOSAL_ID = 'aaaaaaaa-0000-4000-8000-000000000004';
const STAGE_LOST_ID = 'aaaaaaaa-0000-4000-8000-000000000007';

const adminUser: AuthUser = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  sessionId: 'sess-1',
  role: 'ADMIN',
  operationalRole: 'ADMIN',
};

const sellerUser: AuthUser = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  sessionId: 'sess-2',
  role: 'USUARIO',
  operationalRole: 'VENDEDOR',
};

const STAGE_NEW = {
  id: STAGE_NEW_ID,
  tenantId: TENANT_ID,
  name: 'Novo Lead',
  code: '1_novo_lead',
  position: 1,
  colorHex: '#1B4DFF',
  isLostStage: false,
};

const STAGE_QUAL = {
  id: STAGE_QUAL_ID,
  tenantId: TENANT_ID,
  name: 'Qualificação',
  code: '2_qualificacao',
  position: 2,
  colorHex: '#2B6DFF',
  isLostStage: false,
};

const STAGE_PROPOSAL = {
  id: STAGE_PROPOSAL_ID,
  tenantId: TENANT_ID,
  name: 'Proposta',
  code: '4_proposta',
  position: 4,
  colorHex: '#4B8DFF',
  isLostStage: false,
};

const STAGE_LOST = {
  id: STAGE_LOST_ID,
  tenantId: TENANT_ID,
  name: 'Perdido',
  code: '7_perdido',
  position: 7,
  colorHex: '#FF4B4B',
  isLostStage: true,
};

/** Linha do funil como o `GET /leads/pipeline` a devolve. */
function pipelineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_LEAD_ID,
    tenantId: TENANT_ID,
    leadId: LEAD_ID,
    stageId: STAGE_NEW_ID,
    assignedUserId: USER_ID,
    creatorUserId: USER_ID,
    status: 'CLAIMED' as TenantLeadStatus,
    ticketValue: null,
    closeProbability: null,
    expectedCloseDate: null,
    proposalScope: null,
    lossReasonCode: null,
    lossReasonNotes: null,
    version: 3,
    lastContactAt: null,
    claimedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lead: {
      companyName: 'Solar Tech Engenharia LTDA',
      tradeName: 'Solar Tech',
      cnpj: '33456789000102',
      city: 'Belo Horizonte',
      state: 'MG',
    },
    assignedUser: { id: USER_ID, name: 'Ana Vendas' },
    ...overrides,
  };
}

/** `TenantLead` + `stage` como `findTenantLead` lê antes da escrita. */
function currentLead(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_LEAD_ID,
    tenantId: TENANT_ID,
    leadId: LEAD_ID,
    stageId: STAGE_QUAL_ID,
    assignedUserId: USER_ID,
    creatorUserId: USER_ID,
    status: 'CLAIMED' as TenantLeadStatus,
    version: 3,
    lossReasonCode: null,
    lossReasonNotes: null,
    stage: STAGE_QUAL,
    ...overrides,
  };
}

function createPrismaDouble() {
  const tx = {
    tenantLead: {
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    leadTimelineNote: { create: vi.fn() },
  };

  const prisma = {
    stage: { findMany: vi.fn(), findFirst: vi.fn() },
    tenantLead: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(
      async (arg: unknown, _options?: unknown): Promise<unknown> => {
        if (typeof arg === 'function') {
          return (arg as (client: typeof tx) => Promise<unknown>)(tx);
        }

        return Promise.all(arg as Promise<unknown>[]);
      },
    ),
  };

  return { prisma, tx };
}

async function expectBusinessError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<BusinessException> {
  const error = await promise.then(
    () => null,
    (thrown: unknown) => thrown,
  );

  expect(error).toBeInstanceOf(BusinessException);

  const businessError = error as BusinessException;

  expect(businessError.getStatus()).toBe(status);
  expect(businessError.code).toBe(code);

  return businessError;
}

/** Reproduz o `ValidationPipe` global (`transform` + `whitelist`). */
async function runValidationPipe(
  value: Record<string, unknown>,
  metatype: ArgumentMetadata['metatype'],
): Promise<unknown> {
  const pipe = new ValidationPipe(validationPipeOptions);
  const metadata: ArgumentMetadata = { type: 'body', metatype };

  return pipe.transform(value, metadata);
}

async function expectValidation400(
  value: Record<string, unknown>,
  metatype: ArgumentMetadata['metatype'],
): Promise<void> {
  const error = await runValidationPipe(value, metatype).then(
    () => null,
    (thrown: unknown) => thrown,
  );

  expect(error).toBeInstanceOf(BadRequestException);
  expect((error as BadRequestException).getStatus()).toBe(400);
}

/** `AAAA-MM-DD` do dia local de hoje. */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe('PipelineService', () => {
  let prisma: ReturnType<typeof createPrismaDouble>['prisma'];
  let tx: ReturnType<typeof createPrismaDouble>['tx'];
  let events: PipelineEventsService;
  let emitSpy: ReturnType<typeof vi.spyOn>;
  let service: PipelineService;

  beforeEach(() => {
    ({ prisma, tx } = createPrismaDouble());
    events = new PipelineEventsService();
    emitSpy = vi.spyOn(events, 'emit');
    service = new PipelineService(prisma as unknown as PrismaService, events);

    prisma.tenantLead.findFirst.mockResolvedValue(currentLead());
    prisma.stage.findFirst.mockResolvedValue(STAGE_PROPOSAL);
    tx.tenantLead.updateMany.mockResolvedValue({ count: 1 });
    tx.leadTimelineNote.create.mockResolvedValue({ id: 'note-1' });
    tx.tenantLead.findFirstOrThrow.mockResolvedValue(pipelineRow());
  });

  /** Arruma a escrita: card atual, etapa de destino e retorno atualizado. */
  function arrangeWrite(options: {
    current?: Record<string, unknown>;
    targetStage?: Record<string, unknown>;
    updated?: Record<string, unknown>;
  } = {}) {
    prisma.tenantLead.findFirst.mockResolvedValue(currentLead(options.current));
    prisma.stage.findFirst.mockResolvedValue(options.targetStage ?? STAGE_PROPOSAL);
    tx.tenantLead.findFirstOrThrow.mockResolvedValue(pipelineRow(options.updated));
  }

  describe('getPipeline', () => {
    it('devolve todas as etapas do tenant, inclusive vazias, ordenadas por position @spec:AC-084', async () => {
      prisma.stage.findMany.mockResolvedValue([STAGE_NEW, STAGE_QUAL, STAGE_LOST]);
      prisma.tenantLead.findMany.mockResolvedValue([
        pipelineRow({
          stageId: STAGE_NEW_ID,
          ticketValue: new Prisma.Decimal('10000.00'),
          lastContactAt: null,
        }),
        pipelineRow({
          id: '55555555-5555-4555-8555-000000000002',
          stageId: STAGE_LOST_ID,
          status: 'LOST',
          ticketValue: null,
          lastContactAt: hoursAgo(72),
        }),
      ]);

      const result = await service.getPipeline(adminUser, {});

      expect(prisma.stage.findMany.mock.calls[0][0]).toMatchObject({
        where: { tenantId: TENANT_ID },
        orderBy: { position: 'asc' },
      });
      expect(result.stages.map((column) => column.stage.code)).toEqual([
        '1_novo_lead',
        '2_qualificacao',
        '7_perdido',
      ]);
      // A coluna do meio não tem card, mas continua no funil.
      expect(result.stages[1]).toMatchObject({ cards: [], count: 0, total_value: 0 });
      expect(result.stages[0].count).toBe(1);
      expect(result.stages[0].total_value).toBe(10000);
    });

    it('marca has_alert em card nunca contatado ou parado há mais de 48h @spec:AC-085', async () => {
      prisma.stage.findMany.mockResolvedValue([STAGE_NEW]);
      prisma.tenantLead.findMany.mockResolvedValue([
        pipelineRow({ id: 'card-1', lastContactAt: null }),
        pipelineRow({ id: 'card-2', lastContactAt: hoursAgo(49) }),
        pipelineRow({ id: 'card-3', lastContactAt: hoursAgo(1) }),
      ]);

      const result = await service.getPipeline(adminUser, {});
      const cards = result.stages[0].cards;

      expect(cards[0].has_alert).toBe(true);
      expect(cards[1].has_alert).toBe(true);
      expect(cards[2].has_alert).toBe(false);
    });

    it('has_alerts=true devolve só os cards em alerta e recalcula os somatórios', async () => {
      prisma.stage.findMany.mockResolvedValue([STAGE_NEW]);
      prisma.tenantLead.findMany.mockResolvedValue([
        pipelineRow({
          id: 'card-1',
          lastContactAt: null,
          ticketValue: new Prisma.Decimal('1000.00'),
        }),
        pipelineRow({
          id: 'card-2',
          lastContactAt: hoursAgo(1),
          ticketValue: new Prisma.Decimal('9000.00'),
        }),
      ]);

      const result = await service.getPipeline(adminUser, { has_alerts: true });

      expect(result.stages[0].cards).toHaveLength(1);
      expect(result.stages[0].cards[0].id).toBe('card-1');
      expect(result.stages[0].total_value).toBe(1000);
      expect(result.totals.total_value).toBe(1000);
    });

    it('assigned_user_id=me filtra pelo usuário da sessão', async () => {
      prisma.stage.findMany.mockResolvedValue([]);
      prisma.tenantLead.findMany.mockResolvedValue([]);

      await service.getPipeline(adminUser, { assigned_user_id: 'me' });

      const where = prisma.tenantLead.findMany.mock.calls[0][0].where as {
        AND: Record<string, unknown>[];
      };

      expect(where.AND).toContainEqual({ tenantId: TENANT_ID });
      expect(where.AND).toContainEqual({ assignedUserId: USER_ID });
    });

    it('VENDEDOR é forçado ao próprio id mesmo pedindo all @spec:AC-086', async () => {
      prisma.stage.findMany.mockResolvedValue([]);
      prisma.tenantLead.findMany.mockResolvedValue([]);

      await service.getPipeline(sellerUser, { assigned_user_id: 'all' });

      const where = prisma.tenantLead.findMany.mock.calls[0][0].where as {
        AND: Record<string, unknown>[];
      };

      expect(where.AND).toContainEqual({ assignedUserId: USER_ID });
      expect(where.AND).not.toContainEqual({ assignedUserId: 'all' });
    });

    it('Admin pode filtrar pela carteira de outro vendedor', async () => {
      prisma.stage.findMany.mockResolvedValue([]);
      prisma.tenantLead.findMany.mockResolvedValue([]);

      await service.getPipeline(adminUser, { assigned_user_id: OTHER_USER_ID });

      const where = prisma.tenantLead.findMany.mock.calls[0][0].where as {
        AND: Record<string, unknown>[];
      };

      expect(where.AND).toContainEqual({ assignedUserId: OTHER_USER_ID });
    });

    it('totals excluem os leads sem responsável (Pool), mas os cards continuam na coluna @spec:AC-087', async () => {
      prisma.stage.findMany.mockResolvedValue([STAGE_NEW]);
      prisma.tenantLead.findMany.mockResolvedValue([
        pipelineRow({
          id: 'carteira',
          assignedUserId: USER_ID,
          assignedUser: { id: USER_ID, name: 'Ana Vendas' },
          ticketValue: new Prisma.Decimal('30000.00'),
        }),
        pipelineRow({
          id: 'pool',
          assignedUserId: null,
          assignedUser: null,
          ticketValue: new Prisma.Decimal('70000.00'),
        }),
      ]);

      const result = await service.getPipeline(adminUser, {});

      expect(result.stages[0].cards).toHaveLength(2);
      expect(result.stages[0].count).toBe(2);
      expect(result.stages[0].total_value).toBe(100000);
      expect(result.totals).toEqual({ count: 1, total_value: 30000 });
    });

    it('devolve ticket_value como number, nunca como Decimal/string', async () => {
      prisma.stage.findMany.mockResolvedValue([STAGE_NEW]);
      prisma.tenantLead.findMany.mockResolvedValue([
        pipelineRow({ ticketValue: new Prisma.Decimal('1234.56') }),
      ]);

      const result = await service.getPipeline(adminUser, {});

      expect(typeof result.stages[0].cards[0].ticket_value).toBe('number');
      expect(result.stages[0].cards[0].ticket_value).toBe(1234.56);
    });

    it('aplica a ordenação pedida na consulta dos cards', async () => {
      prisma.stage.findMany.mockResolvedValue([]);
      prisma.tenantLead.findMany.mockResolvedValue([]);

      await service.getPipeline(adminUser, { order_by: 'ticket_asc' });

      expect(prisma.tenantLead.findMany.mock.calls[0][0].orderBy).toEqual([
        { ticketValue: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ]);
    });
  });

  describe('moveStage', () => {
    it('move o card, zera o relógio do alerta e registra a timeline na mesma transação @spec:AC-088', async () => {
      arrangeWrite({ updated: { stageId: STAGE_PROPOSAL_ID, version: 4 } });

      const card = await service.moveStage(adminUser, TENANT_LEAD_ID, {
        new_stage: '4_proposta',
        version: 3,
      });

      expect(prisma.stage.findFirst.mock.calls[0][0]).toEqual({
        where: { tenantId: TENANT_ID, code: '4_proposta' },
      });
      expect(tx.tenantLead.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: TENANT_LEAD_ID, tenantId: TENANT_ID, version: 3 },
        data: {
          stageId: STAGE_PROPOSAL_ID,
          lastContactAt: expect.any(Date),
          version: { increment: 1 },
        },
      });
      expect(tx.leadTimelineNote.create.mock.calls[0][0].data).toMatchObject({
        tenantLeadId: TENANT_LEAD_ID,
        userId: USER_ID,
        type: 'STATUS_CHANGE',
        title: 'Etapa alterada para Proposta',
        content: 'Etapa anterior: Qualificação',
      });
      expect(card.stage_id).toBe(STAGE_PROPOSAL_ID);
      expect(card.version).toBe(4);
    });

    it('emite o evento do funil para o tenant da sessão @spec:AC-098', async () => {
      arrangeWrite();

      await service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '4_proposta', version: 3 });

      expect(emitSpy).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        tenantLeadId: TENANT_LEAD_ID,
        stageId: STAGE_PROPOSAL_ID,
        movedBy: USER_ID,
      });
    });

    it('version divergente (updateMany com count 0) responde 409 VERSION_CONFLICT @spec:AC-089', async () => {
      arrangeWrite();
      tx.tenantLead.updateMany.mockResolvedValue({ count: 0 });

      await expectBusinessError(
        service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '4_proposta', version: 3 }),
        409,
        'VERSION_CONFLICT',
      );

      // Nada é gravado: nem a nota da timeline.
      expect(tx.leadTimelineNote.create).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('aceita expected_version como apelido de version', async () => {
      arrangeWrite();

      await service.moveStage(adminUser, TENANT_LEAD_ID, {
        new_stage: '4_proposta',
        expected_version: 3,
      });

      expect(tx.tenantLead.updateMany.mock.calls[0][0].where).toMatchObject({ version: 3 });
    });

    it('o expected_version sobrevive ao whitelist do ValidationPipe', async () => {
      const dto = await runValidationPipe(
        { new_stage: '4_proposta', expected_version: 3 },
        MoveStageDto,
      );

      expect(dto).toMatchObject({ new_stage: '4_proposta', expected_version: 3 });
    });

    it('mover para a etapa de perda sem motivo responde 422 LOSS_REASON_REQUIRED @spec:AC-090', async () => {
      arrangeWrite({ targetStage: STAGE_LOST });

      await expectBusinessError(
        service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '7_perdido', version: 3 }),
        422,
        'LOSS_REASON_REQUIRED',
      );

      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('mover para a etapa de perda grava o motivo canônico e o status LOST', async () => {
      arrangeWrite({ targetStage: STAGE_LOST, updated: { status: 'LOST' } });

      await service.moveStage(adminUser, TENANT_LEAD_ID, {
        new_stage: '7_perdido',
        version: 3,
        loss_reason_code: 'fechou_concorrente',
        loss_reason_notes: 'Cliente fechou em 12x sem juros.',
      });

      expect(tx.tenantLead.updateMany.mock.calls[0][0].data).toMatchObject({
        stageId: STAGE_LOST_ID,
        status: 'LOST',
        lossReasonCode: 'concorrencia',
        lossReasonNotes: 'Cliente fechou em 12x sem juros.',
      });
      expect(tx.leadTimelineNote.create.mock.calls[0][0].data.content).toContain(
        'Fechou com Concorrente',
      );
    });

    it('sair da etapa de perda limpa o motivo e devolve o lead ao Pool quando não há responsável @spec:AC-091', async () => {
      arrangeWrite({
        current: { status: 'LOST', assignedUserId: null, stage: STAGE_LOST, stageId: STAGE_LOST_ID },
      });

      await service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '4_proposta', version: 3 });

      expect(tx.tenantLead.updateMany.mock.calls[0][0].data).toMatchObject({
        lossReasonCode: null,
        lossReasonNotes: null,
        status: 'AVAILABLE',
      });
    });

    it('sair da etapa de perda mantém CLAIMED quando existe responsável', async () => {
      arrangeWrite({
        current: { status: 'LOST', assignedUserId: USER_ID, stage: STAGE_LOST },
      });

      await service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '4_proposta', version: 3 });

      expect(tx.tenantLead.updateMany.mock.calls[0][0].data).toMatchObject({
        status: 'CLAIMED',
      });
    });

    it('VENDEDOR não mexe em card de outro vendedor (403 FORBIDDEN) @spec:AC-097', async () => {
      arrangeWrite({ current: { assignedUserId: OTHER_USER_ID } });

      await expectBusinessError(
        service.moveStage(sellerUser, TENANT_LEAD_ID, { new_stage: '4_proposta', version: 3 }),
        403,
        'FORBIDDEN',
      );

      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('id fora do formato UUID responde 404 LEAD_NOT_FOUND', async () => {
      await expectBusinessError(
        service.moveStage(adminUser, 'nao-e-uuid', { new_stage: '4_proposta', version: 3 }),
        404,
        'LEAD_NOT_FOUND',
      );

      expect(prisma.tenantLead.findFirst).not.toHaveBeenCalled();
    });

    it('etapa de destino inexistente responde 422 INVALID_STAGE_TRANSITION', async () => {
      arrangeWrite();
      prisma.stage.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '9_inexistente', version: 3 }),
        422,
        'INVALID_STAGE_TRANSITION',
      );
    });

    it('sem version/expected_version responde 400 VALIDATION_ERROR', async () => {
      arrangeWrite();

      await expectBusinessError(
        service.moveStage(adminUser, TENANT_LEAD_ID, { new_stage: '4_proposta' }),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('devolve ticket_value como number', async () => {
      arrangeWrite({ updated: { ticketValue: new Prisma.Decimal('42000.00') } });

      const card = await service.moveStage(adminUser, TENANT_LEAD_ID, {
        new_stage: '4_proposta',
        version: 3,
      });

      expect(typeof card.ticket_value).toBe('number');
      expect(card.ticket_value).toBe(42000);
    });
  });

  describe('updateCommercialTerms', () => {
    it('persiste os termos, incrementa a versão e registra a timeline @spec:AC-092', async () => {
      arrangeWrite({ updated: { ticketValue: new Prisma.Decimal('42000.00') } });

      const card = await service.updateCommercialTerms(adminUser, TENANT_LEAD_ID, {
        version: 3,
        ticket_value: 42000,
        close_probability_percentage: 70,
        expected_close_date: '2027-11-15',
        proposal_scope: 'Sistema solar de 50kWp',
      });

      const data = tx.tenantLead.updateMany.mock.calls[0][0].data as Record<string, unknown>;

      expect(data).toMatchObject({
        ticketValue: 42000,
        closeProbability: 70,
        proposalScope: 'Sistema solar de 50kWp',
        version: { increment: 1 },
      });
      expect(data.expectedCloseDate).toBeInstanceOf(Date);
      expect((data.expectedCloseDate as Date).toISOString()).toBe('2027-11-15T00:00:00.000Z');

      const note = tx.leadTimelineNote.create.mock.calls[0][0].data as Record<string, unknown>;

      expect(note.title).toBe('Termos comerciais atualizados');
      expect(note.content).toContain('probabilidade de 70%');

      expect(typeof card.ticket_value).toBe('number');
      expect(card.ticket_value).toBe(42000);
    });

    it('aceita a data de hoje (o modal só proíbe data passada)', async () => {
      arrangeWrite();

      await service.updateCommercialTerms(adminUser, TENANT_LEAD_ID, {
        version: 3,
        expected_close_date: todayIsoDate(),
      });

      const data = tx.tenantLead.updateMany.mock.calls[0][0].data as {
        expectedCloseDate: Date;
      };

      expect(data.expectedCloseDate).toBeInstanceOf(Date);
      expect(data.expectedCloseDate.getUTCDate()).toBe(new Date().getDate());
    });

    it('recusa data de fechamento no passado com 400 VALIDATION_ERROR @spec:AC-094', async () => {
      arrangeWrite();

      await expectBusinessError(
        service.updateCommercialTerms(adminUser, TENANT_LEAD_ID, {
          version: 3,
          expected_close_date: '2020-01-01',
        }),
        400,
        'VALIDATION_ERROR',
      );

      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('o ValidationPipe recusa close_probability fora de 0–100 @spec:AC-093', async () => {
      await expectValidation400(
        { version: 3, close_probability: 101 },
        CommercialTermsDto,
      );
      await expectValidation400(
        { version: 3, close_probability: -1 },
        CommercialTermsDto,
      );
    });

    it('o ValidationPipe recusa ticket_value negativo', async () => {
      await expectValidation400({ version: 3, ticket_value: -100 }, CommercialTermsDto);
    });

    it('VENDEDOR não altera termos de card de outro vendedor (403 FORBIDDEN)', async () => {
      arrangeWrite({ current: { assignedUserId: OTHER_USER_ID } });

      await expectBusinessError(
        service.updateCommercialTerms(sellerUser, TENANT_LEAD_ID, {
          version: 3,
          ticket_value: 1000,
        }),
        403,
        'FORBIDDEN',
      );
    });

    it('version divergente responde 409 VERSION_CONFLICT', async () => {
      arrangeWrite();
      tx.tenantLead.updateMany.mockResolvedValue({ count: 0 });

      await expectBusinessError(
        service.updateCommercialTerms(adminUser, TENANT_LEAD_ID, {
          version: 3,
          ticket_value: 1000,
        }),
        409,
        'VERSION_CONFLICT',
      );
    });
  });

  describe('markAsLost', () => {
    it('move para a etapa de perda, grava o motivo e cria a nota na mesma transação @spec:AC-096', async () => {
      arrangeWrite({ targetStage: STAGE_LOST, updated: { status: 'LOST' } });

      const card = await service.markAsLost(adminUser, TENANT_LEAD_ID, {
        version: 3,
        loss_reason_code: 'preco',
        additional_notes: 'Cliente achou caro.',
      });

      expect(prisma.stage.findFirst.mock.calls[0][0]).toEqual({
        where: { tenantId: TENANT_ID, isLostStage: true },
        orderBy: { position: 'desc' },
      });
      expect(tx.tenantLead.updateMany.mock.calls[0][0].data).toMatchObject({
        stageId: STAGE_LOST_ID,
        status: 'LOST',
        lossReasonCode: 'preco',
        lossReasonNotes: 'Cliente achou caro.',
        version: { increment: 1 },
      });
      expect(tx.leadTimelineNote.create).toHaveBeenCalledTimes(1);
      expect(tx.leadTimelineNote.create.mock.calls[0][0].data).toMatchObject({
        tenantLeadId: TENANT_LEAD_ID,
        userId: USER_ID,
        title: 'Etapa alterada para Perdido',
      });
      expect(tx.leadTimelineNote.create.mock.calls[0][0].data.content).toContain(
        'Preço Alto / Fora do Orçamento do Cliente',
      );
      expect(card.status).toBe('LOST');
      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, stageId: STAGE_LOST_ID }),
      );
    });

    it('aceita expected_version como apelido de version', async () => {
      arrangeWrite({ targetStage: STAGE_LOST });

      await service.markAsLost(adminUser, TENANT_LEAD_ID, {
        expected_version: 3,
        loss_reason_code: 'timing',
      });

      expect(tx.tenantLead.updateMany.mock.calls[0][0].where).toMatchObject({ version: 3 });
    });

    it('motivo fora do catálogo responde 422 LOSS_REASON_REQUIRED sem tocar no banco', async () => {
      arrangeWrite({ targetStage: STAGE_LOST });

      await expectBusinessError(
        service.markAsLost(adminUser, TENANT_LEAD_ID, {
          version: 3,
          loss_reason_code: 'mudou_de_ideia',
        }),
        422,
        'LOSS_REASON_REQUIRED',
      );

      expect(prisma.stage.findFirst).not.toHaveBeenCalled();
      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('VENDEDOR não marca como perdido card de outro vendedor (403 FORBIDDEN)', async () => {
      arrangeWrite({ current: { assignedUserId: OTHER_USER_ID }, targetStage: STAGE_LOST });

      await expectBusinessError(
        service.markAsLost(sellerUser, TENANT_LEAD_ID, {
          version: 3,
          loss_reason_code: 'preco',
        }),
        403,
        'FORBIDDEN',
      );
    });

    it('devolve ticket_value como number', async () => {
      arrangeWrite({
        targetStage: STAGE_LOST,
        updated: { status: 'LOST', ticketValue: new Prisma.Decimal('9876.54') },
      });

      const card = await service.markAsLost(adminUser, TENANT_LEAD_ID, {
        version: 3,
        loss_reason_code: 'outro',
      });

      expect(typeof card.ticket_value).toBe('number');
      expect(card.ticket_value).toBe(9876.54);
    });
  });

  describe('PipelineEventsService', () => {
    it('entrega o evento apenas para o stream do tenant certo', () => {
      const received: PipelineLeadMovedEvent[] = [];
      const subscription = events.stream(TENANT_ID).subscribe((event) => received.push(event));

      events.emit({
        tenantId: OTHER_TENANT_ID,
        tenantLeadId: 'outro-lead',
        stageId: 'outra-etapa',
        movedBy: 'outro-usuario',
      });
      events.emit({
        tenantId: TENANT_ID,
        tenantLeadId: TENANT_LEAD_ID,
        stageId: STAGE_PROPOSAL_ID,
        movedBy: USER_ID,
      });

      subscription.unsubscribe();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        tenantId: TENANT_ID,
        tenantLeadId: TENANT_LEAD_ID,
        stageId: STAGE_PROPOSAL_ID,
      });
    });
  });
});

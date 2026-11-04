import type { AuthUser } from '../common/auth/auth.types.js';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  LeadSpecialDateType,
  Prisma,
  type TenantLeadStatus,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CreateManualLeadDto } from './dto/create-manual-lead.dto.js';
import { DAILY_CLAIM_LIMIT } from './leads.constants.js';
import { LeadsService } from './leads.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SELLER_ID = '77777777-7777-4777-8777-777777777777';
const LEAD_ID = '33333333-3333-4333-8333-333333333333';
const STAGE_ID = '44444444-4444-4444-8444-444444444444';
const TENANT_LEAD_ID = '55555555-5555-4555-8555-555555555555';
const CNPJ = '33456789000102';
const CPF = '12345678901';

const adminUser: AuthUser = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  sessionId: 'sess-1',
  role: 'ADMIN',
  operationalRole: 'ADMIN',
};

const sellerUser: AuthUser = {
  userId: SELLER_ID,
  tenantId: TENANT_ID,
  sessionId: 'sess-2',
  role: 'USUARIO',
  operationalRole: 'VENDEDOR',
};

const captorUser: AuthUser = {
  userId: '88888888-8888-4888-8888-888888888888',
  tenantId: TENANT_ID,
  sessionId: 'sess-3',
  role: 'USUARIO',
  operationalRole: 'CAPTADOR',
};

function stageFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: STAGE_ID,
    tenantId: TENANT_ID,
    name: 'Novo Lead',
    code: '1_novo_lead',
    position: 1,
    colorHex: '#1B4DFF',
    isLostStage: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** `Lead` completo como o `select` do serviço o devolve. */
function leadFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    personType: 'PJ',
    cnpj: CNPJ,
    cpf: null,
    companyName: 'Solar Tech Engenharia LTDA',
    tradeName: 'Solar Tech',
    primaryCnae: '4321500',
    cnaeDescription: 'Instalação elétrica',
    capitalSocial: null,
    postalCode: '30130-110',
    street: 'Av. Afonso Pena',
    number: '1500',
    complement: null,
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'MG',
    sector: 'CONSTRUCAO',
    companySize: 'EPP',
    temperature: null,
    temperatureScore: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    contacts: [],
    ...overrides,
  };
}

/** `TenantLead` com as relações que `tenantLeadInclude` pede. */
function tenantLeadFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_LEAD_ID,
    tenantId: TENANT_ID,
    leadId: LEAD_ID,
    stageId: STAGE_ID,
    assignedUserId: null,
    creatorUserId: USER_ID,
    status: 'AVAILABLE' as TenantLeadStatus,
    ticketValue: null,
    closeProbability: null,
    expectedCloseDate: null,
    proposalScope: null,
    customSector: null,
    lossReasonCode: null,
    lossReasonNotes: null,
    version: 1,
    lastContactAt: null,
    claimedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lead: leadFixture(),
    stage: stageFixture(),
    ...overrides,
  };
}

/**
 * Dublê do `PrismaService`.
 *
 * O client de transação (`tx`) é um objeto **separado** do client raiz: assim
 * um teste consegue provar que a escrita passou pelo `$transaction` (se o
 * serviço escrevesse por fora, o método nem existiria no dublê raiz).
 */
function createPrismaDouble() {
  const tx = {
    stage: { findFirst: vi.fn() },
    lead: { upsert: vi.fn(), update: vi.fn() },
    leadContact: { createMany: vi.fn() },
    leadSpecialDate: { createMany: vi.fn() },
    tenantLead: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    leadTimelineNote: { create: vi.fn() },
  };

  const prisma = {
    tenantLead: { findMany: vi.fn(), count: vi.fn() },
    user: { findFirst: vi.fn() },
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

/** Captura a exceção e valida status HTTP + código de contrato. */
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

function manualDto(
  overrides: Partial<CreateManualLeadDto> = {},
): CreateManualLeadDto {
  return {
    person_type: 'PJ',
    cnpj: CNPJ,
    company_name: 'Solar Tech Engenharia LTDA',
    ...overrides,
  };
}

describe('LeadsService', () => {
  let prisma: ReturnType<typeof createPrismaDouble>['prisma'];
  let tx: ReturnType<typeof createPrismaDouble>['tx'];
  let service: LeadsService;

  beforeEach(() => {
    ({ prisma, tx } = createPrismaDouble());
    service = new LeadsService(prisma as unknown as PrismaService);

    tx.stage.findFirst.mockResolvedValue(stageFixture());
    tx.lead.upsert.mockResolvedValue(leadFixture());
    tx.lead.update.mockResolvedValue(leadFixture());
    tx.leadContact.createMany.mockResolvedValue({ count: 0 });
    tx.leadSpecialDate.createMany.mockResolvedValue({ count: 0 });
    tx.tenantLead.findUnique.mockResolvedValue(null);
    tx.tenantLead.create.mockResolvedValue(tenantLeadFixture());
    tx.leadTimelineNote.create.mockResolvedValue({ id: 'note-1' });
  });

  describe('createManual', () => {
    it('usa o tenantId da sessão e ignora um tenantId vindo do corpo', async () => {
      const dto = {
        person_type: 'PJ',
        cnpj: CNPJ,
        company_name: 'Solar Tech Engenharia LTDA',
        tenantId: OTHER_TENANT_ID,
      } as unknown as CreateManualLeadDto;

      await service.createManual(dto, TENANT_ID, USER_ID);

      expect(tx.stage.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID },
        orderBy: { position: 'asc' },
      });
      expect(tx.tenantLead.findUnique).toHaveBeenCalledWith({
        where: { tenantId_leadId: { tenantId: TENANT_ID, leadId: LEAD_ID } },
        select: { id: true },
      });
      expect(tx.tenantLead.create.mock.calls[0][0].data.tenantId).toBe(
        TENANT_ID,
      );
      expect(JSON.stringify(tx.tenantLead.create.mock.calls)).not.toContain(
        OTHER_TENANT_ID,
      );
      expect(JSON.stringify(tx.tenantLead.findUnique.mock.calls)).not.toContain(
        OTHER_TENANT_ID,
      );
    });

    it('grava contatos e datas especiais com o tenantId da sessão', async () => {
      await service.createManual(
        manualDto({
          contacts: [
            {
              name: 'Marcelo Dias',
              role: 'Sócio-Diretor',
              phone: '31988887777',
              email: 'marcelo@solartech.com.br',
              birthday: '1982-11-14',
              is_primary: true,
              is_decision_maker: true,
            },
          ],
          special_dates: [
            {
              date_type: LeadSpecialDateType.ANIVERSARIO_SOCIO,
              day_month: '14/11',
              description: 'Aniversário do sócio',
            },
          ],
        }),
        TENANT_ID,
        USER_ID,
      );

      const contacts = tx.leadContact.createMany.mock.calls[0][0].data as Array<
        Record<string, unknown>
      >;
      const dates = tx.leadSpecialDate.createMany.mock.calls[0][0]
        .data as Array<Record<string, unknown>>;

      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({
        tenantId: TENANT_ID,
        leadId: LEAD_ID,
        name: 'Marcelo Dias',
        role: 'Sócio-Diretor',
        phone: '31988887777',
        email: 'marcelo@solartech.com.br',
        isPrimary: true,
        isDecisionMaker: true,
      });
      expect(contacts[0].birthday).toBeInstanceOf(Date);

      expect(dates).toHaveLength(1);
      expect(dates[0]).toMatchObject({
        tenantId: TENANT_ID,
        leadId: LEAD_ID,
        dateType: LeadSpecialDateType.ANIVERSARIO_SOCIO,
        dayMonth: '14/11',
        description: 'Aniversário do sócio',
      });
    });

    it('deriva o setor salvo do CNAE informado @spec:AC-180', async () => {
      tx.lead.upsert.mockResolvedValue(
        leadFixture({ primaryCnae: null, sector: 'OUTROS' }),
      );

      await service.createManual(
        manualDto({ primary_cnae: '0101501', sector: 'SOLAR' }),
        TENANT_ID,
        USER_ID,
      );

      expect(tx.lead.upsert.mock.calls[0][0].create).toMatchObject({
        primaryCnae: '0101501',
        sector: 'AGROPECUARIA',
      });
      expect(tx.lead.update.mock.calls[0][0].data).toMatchObject({
        sector: 'AGROPECUARIA',
      });
    });

    it('guarda categorias internas separadas para cada tenant @spec:AC-181', async () => {
      tx.tenantLead.create.mockResolvedValueOnce(
        tenantLeadFixture({ customSector: 'Instaladores' }),
      );

      const first = await service.createManual(
        manualDto({ custom_sector: 'Instaladores' }),
        TENANT_ID,
        USER_ID,
      );

      tx.stage.findFirst.mockResolvedValue(
        stageFixture({ tenantId: OTHER_TENANT_ID }),
      );
      tx.tenantLead.create.mockResolvedValue(
        tenantLeadFixture({
          tenantId: OTHER_TENANT_ID,
          customSector: 'Integradores',
        }),
      );

      const second = await service.createManual(
        manualDto({ custom_sector: 'Integradores' }),
        OTHER_TENANT_ID,
        USER_ID,
      );

      expect(first.customSector).toBe('Instaladores');
      expect(second.customSector).toBe('Integradores');

      expect(
        tx.tenantLead.create.mock.calls.map((call) => call[0].data),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tenantId: TENANT_ID,
            customSector: 'Instaladores',
          }),
          expect.objectContaining({
            tenantId: OTHER_TENANT_ID,
            customSector: 'Integradores',
          }),
        ]),
      );
    });

    it('reaproveita o Lead global e só preenche os campos vazios @spec:AC-070', async () => {
      tx.lead.upsert.mockResolvedValue(
        leadFixture({
          companyName: 'Solar Tech Engenharia LTDA',
          tradeName: '   ',
          city: null,
          capitalSocial: new Prisma.Decimal('500000.00'),
        }),
      );

      await service.createManual(
        manualDto({
          company_name: 'Nome digitado por este tenant',
          trade_name: 'Fantasia deste tenant',
          city: 'Contagem',
          capital_social: 999999,
        }),
        TENANT_ID,
        USER_ID,
      );

      expect(tx.lead.upsert.mock.calls[0][0]).toMatchObject({
        where: { cnpj: CNPJ },
        update: {},
      });

      expect(tx.lead.update).toHaveBeenCalledTimes(1);
      expect(tx.lead.update.mock.calls[0][0]).toEqual({
        where: { id: LEAD_ID },
        data: { tradeName: 'Fantasia deste tenant', city: 'Contagem' },
      });
    });

    it('não escreve nada quando todos os campos do cadastro já estão preenchidos', async () => {
      await service.createManual(manualDto(), TENANT_ID, USER_ID);

      expect(tx.lead.update).not.toHaveBeenCalled();
    });

    it('usa upsert por CNPJ para PJ e por CPF para PF @spec:AC-068', async () => {
      await service.createManual(manualDto(), TENANT_ID, USER_ID);

      expect(tx.lead.upsert.mock.calls[0][0].where).toEqual({ cnpj: CNPJ });
      expect(tx.lead.upsert.mock.calls[0][0].create).toMatchObject({
        personType: 'PJ',
        cnpj: CNPJ,
        cpf: null,
      });

      tx.lead.upsert.mockClear();

      await service.createManual(
        {
          person_type: 'PF',
          cpf: '123.456.789-01',
          company_name: 'João da Silva',
        },
        TENANT_ID,
        USER_ID,
      );

      expect(tx.lead.upsert.mock.calls[0][0].where).toEqual({ cpf: CPF });
      expect(tx.lead.upsert.mock.calls[0][0].create).toMatchObject({
        personType: 'PF',
        cnpj: null,
        cpf: CPF,
      });
    });

    it('devolve 400 quando o documento do tipo escolhido não foi informado', async () => {
      await expectBusinessError(
        service.createManual({ person_type: 'PJ' }, TENANT_ID, USER_ID),
        400,
        'VALIDATION_ERROR',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('devolve 422 quando a corporação não tem etapas configuradas', async () => {
      tx.stage.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.createManual(manualDto(), TENANT_ID, USER_ID),
        422,
        'STAGE_NOT_CONFIGURED',
      );

      expect(tx.tenantLead.create).not.toHaveBeenCalled();
    });

    it('devolve 409 quando a carteira do tenant já tem este documento @spec:AC-069', async () => {
      tx.tenantLead.findUnique.mockResolvedValue({
        id: 'tenant-lead-existente',
      });

      const error = await expectBusinessError(
        service.createManual(manualDto(), TENANT_ID, USER_ID),
        409,
        'LEAD_ALREADY_EXISTS',
      );

      expect(error.details).toEqual({
        tenant_lead_id: 'tenant-lead-existente',
      });
      expect(tx.tenantLead.create).not.toHaveBeenCalled();
    });

    it('trata P2002 como corrida perdida: 409 LEAD_ALREADY_EXISTS', async () => {
      tx.lead.upsert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.1',
        }),
      );

      await expectBusinessError(
        service.createManual(manualDto(), TENANT_ID, USER_ID),
        409,
        'LEAD_ALREADY_EXISTS',
      );
    });

    it('entra no Pool como AVAILABLE e sem responsável por padrão @spec:AC-067', async () => {
      await service.createManual(manualDto(), TENANT_ID, USER_ID);

      expect(tx.tenantLead.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT_ID,
        leadId: LEAD_ID,
        stageId: STAGE_ID,
        creatorUserId: USER_ID,
        assignedUserId: null,
        status: 'AVAILABLE',
      });
      expect(tx.leadTimelineNote.create.mock.calls[0][0].data).toMatchObject({
        tenantLeadId: TENANT_LEAD_ID,
        userId: USER_ID,
        type: 'NOTE',
        title: 'Lead cadastrado manualmente',
      });
    });

    it('com assign_to_me entra na carteira de quem cadastrou @spec:AC-071', async () => {
      tx.tenantLead.create.mockResolvedValue(
        tenantLeadFixture({ status: 'CLAIMED', assignedUserId: USER_ID }),
      );

      const created = await service.createManual(
        manualDto({ assign_to_me: true }),
        TENANT_ID,
        USER_ID,
      );

      expect(tx.tenantLead.create.mock.calls[0][0].data).toMatchObject({
        assignedUserId: USER_ID,
        status: 'CLAIMED',
      });
      expect(created.status).toBe('CLAIMED');
      expect(created.assignedUserId).toBe(USER_ID);
    });

    it('devolve o ticket como number na resposta', async () => {
      tx.tenantLead.create.mockResolvedValue(
        tenantLeadFixture({ ticketValue: new Prisma.Decimal('1500.50') }),
      );

      const created = await service.createManual(
        manualDto(),
        TENANT_ID,
        USER_ID,
      );

      expect(typeof created.ticketValue).toBe('number');
      expect(created.ticketValue).toBe(1500.5);
    });
  });

  describe('findPool', () => {
    it('aplica page/limit e devolve os metadados de paginação', async () => {
      prisma.tenantLead.findMany.mockResolvedValue([
        tenantLeadFixture({ ticketValue: new Prisma.Decimal('1500.50') }),
      ]);
      prisma.tenantLead.count.mockResolvedValue(21);

      const page = await service.findPool({ page: 2, limit: 10 }, TENANT_ID);

      expect(prisma.tenantLead.findMany.mock.calls[0][0]).toMatchObject({
        skip: 10,
        take: 10,
      });
      expect(prisma.tenantLead.count.mock.calls[0][0]).toMatchObject({
        where: { tenantId: TENANT_ID },
      });
      expect(page.meta).toEqual({
        page: 2,
        limit: 10,
        total: 21,
        has_more: true,
      });
      expect(page.items).toHaveLength(1);
      expect(typeof page.items[0].ticketValue).toBe('number');
      expect(page.items[0].ticketValue).toBe(1500.5);
    });

    it('filtra os contatos da resposta pelo tenant da sessão', async () => {
      prisma.tenantLead.findMany.mockResolvedValue([]);
      prisma.tenantLead.count.mockResolvedValue(0);

      await service.findPool({}, TENANT_ID);

      const args = prisma.tenantLead.findMany.mock.calls[0][0] as {
        include: { lead: { include: { contacts: { where: unknown } } } };
      };

      expect(args.include.lead.include.contacts.where).toEqual({
        tenantId: TENANT_ID,
      });
    });

    it('recusa limit acima de 100 com 400 INVALID_PAGINATION', async () => {
      await expectBusinessError(
        service.findPool({ limit: 101 }, TENANT_ID),
        400,
        'INVALID_PAGINATION',
      );

      expect(prisma.tenantLead.findMany).not.toHaveBeenCalled();
    });
  });

  describe('claim', () => {
    function arrangeClaimable(overrides: Record<string, unknown> = {}) {
      tx.tenantLead.findFirst
        .mockResolvedValueOnce({
          id: TENANT_LEAD_ID,
          version: 3,
          status: 'AVAILABLE' as TenantLeadStatus,
        })
        .mockResolvedValueOnce(
          tenantLeadFixture({
            status: 'CLAIMED',
            assignedUserId: USER_ID,
            version: 4,
          }),
        );
      tx.tenantLead.count.mockResolvedValue(0);
      tx.tenantLead.updateMany.mockResolvedValue({ count: 1 });
      return overrides;
    }

    it('recusa Captador com 403 e não lê nem altera o lead @spec:AC-191', async () => {
      await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, captorUser),
        403,
        'FORBIDDEN',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.tenantLead.findFirst).not.toHaveBeenCalled();
      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('id fora do formato UUID responde 404 LEAD_NOT_FOUND, nunca 500 @spec:AC-080', async () => {
      await expectBusinessError(
        service.claim('nao-e-uuid', TENANT_ID, adminUser),
        404,
        'LEAD_NOT_FOUND',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lead de outro tenant (ou inexistente) responde 404 LEAD_NOT_FOUND', async () => {
      tx.tenantLead.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser),
        404,
        'LEAD_NOT_FOUND',
      );

      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('version divergente responde 409 VERSION_CONFLICT', async () => {
      tx.tenantLead.findFirst.mockResolvedValue({
        id: TENANT_LEAD_ID,
        version: 7,
        status: 'AVAILABLE',
      });

      const error = await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser, { version: 3 }),
        409,
        'VERSION_CONFLICT',
      );

      expect(error.details).toEqual({ current_version: 7 });
      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('aceita expected_version como apelido de version', async () => {
      arrangeClaimable();

      await service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser, {
        expected_version: 3,
      });

      expect(tx.tenantLead.updateMany.mock.calls[0][0].where).toMatchObject({
        version: 3,
      });
    });

    it('lead que não está no Pool responde 409 LEAD_ALREADY_ASSIGNED', async () => {
      tx.tenantLead.findFirst.mockResolvedValue({
        id: TENANT_LEAD_ID,
        version: 1,
        status: 'CLAIMED',
      });

      await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser),
        409,
        'LEAD_ALREADY_ASSIGNED',
      );

      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('updateMany com count 0 (corrida perdida) responde 409 LEAD_ALREADY_ASSIGNED @spec:AC-077', async () => {
      tx.tenantLead.findFirst.mockResolvedValue({
        id: TENANT_LEAD_ID,
        version: 1,
        status: 'RETURNED_TO_POOL',
      });
      tx.tenantLead.count.mockResolvedValue(0);
      tx.tenantLead.updateMany.mockResolvedValue({ count: 0 });

      await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser),
        409,
        'LEAD_ALREADY_ASSIGNED',
      );
    });

    it('capta o lead gravando claimedAt, status e versão dentro de uma transação Serializable @spec:AC-076', async () => {
      arrangeClaimable();

      const claimed = await service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser);

      const updateArgs = tx.tenantLead.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };

      expect(updateArgs.where).toEqual({
        id: TENANT_LEAD_ID,
        tenantId: TENANT_ID,
        status: { in: ['AVAILABLE', 'RETURNED_TO_POOL'] },
        version: 3,
      });
      expect(updateArgs.data).toMatchObject({
        assignedUserId: USER_ID,
        status: 'CLAIMED',
        version: { increment: 1 },
      });
      expect(updateArgs.data.claimedAt).toBeInstanceOf(Date);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][1]).toEqual({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(Prisma.TransactionIsolationLevel.Serializable).toBe(
        'Serializable',
      );

      expect(claimed.status).toBe('CLAIMED');
      expect(claimed.assignedUserId).toBe(USER_ID);
    });

    it('conta a cota do dia por claimedAt desde o início do dia local @spec:AC-078', async () => {
      tx.tenantLead.findFirst.mockResolvedValue({
        id: TENANT_LEAD_ID,
        version: 1,
        status: 'AVAILABLE',
      });
      tx.tenantLead.count.mockResolvedValue(DAILY_CLAIM_LIMIT);

      const error = await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser),
        422,
        'DAILY_CLAIM_LIMIT_EXCEEDED',
      );

      const countArgs = tx.tenantLead.count.mock.calls[0][0] as {
        where: {
          tenantId: string;
          assignedUserId: string;
          claimedAt: { gte: Date };
        };
      };

      expect(countArgs.where.tenantId).toBe(TENANT_ID);
      expect(countArgs.where.assignedUserId).toBe(USER_ID);
      // A cota olha a data da captação, não a última edição do lead.
      expect(countArgs.where).not.toHaveProperty('updatedAt');

      const startOfDay = countArgs.where.claimedAt.gte;
      const now = new Date();

      expect(startOfDay).toBeInstanceOf(Date);
      expect(startOfDay.getFullYear()).toBe(now.getFullYear());
      expect(startOfDay.getMonth()).toBe(now.getMonth());
      expect(startOfDay.getDate()).toBe(now.getDate());
      expect(startOfDay.getHours()).toBe(0);
      expect(startOfDay.getMinutes()).toBe(0);
      expect(startOfDay.getSeconds()).toBe(0);
      expect(startOfDay.getMilliseconds()).toBe(0);

      expect(error.details).toMatchObject({ limit: DAILY_CLAIM_LIMIT });
      expect(tx.tenantLead.updateMany).not.toHaveBeenCalled();
    });

    it('Admin pode atribuir a captação a um vendedor do tenant @spec:AC-079', async () => {
      arrangeClaimable();
      prisma.user.findFirst.mockResolvedValue({ id: SELLER_ID });

      await service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser, {
        assign_to_user_id: SELLER_ID,
      });

      expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
        id: SELLER_ID,
        tenantId: TENANT_ID,
        status: 'ACTIVE',
      });
      expect(
        tx.tenantLead.updateMany.mock.calls[0][0].data.assignedUserId,
      ).toBe(SELLER_ID);
      expect(tx.tenantLead.count.mock.calls[0][0].where.assignedUserId).toBe(
        SELLER_ID,
      );
    });

    it('Admin com assign_to_user_id inexistente recebe 404 USER_NOT_FOUND', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser, {
          assign_to_user_id: SELLER_ID,
        }),
        404,
        'USER_NOT_FOUND',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('VENDEDOR tem o assign_to_user_id ignorado e capta para si', async () => {
      arrangeClaimable();

      await service.claim(TENANT_LEAD_ID, TENANT_ID, sellerUser, {
        assign_to_user_id: SELLER_ID,
      });

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(
        tx.tenantLead.updateMany.mock.calls[0][0].data.assignedUserId,
      ).toBe(SELLER_ID);
    });

    it('conflito de serialização (P2034) vira 409 CONFLICT, não 500', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('could not serialize access', {
          code: 'P2034',
          clientVersion: '7.10.1',
        }),
      );

      await expectBusinessError(
        service.claim(TENANT_LEAD_ID, TENANT_ID, adminUser),
        409,
        'CONFLICT',
      );
    });
  });
});

import { plainToInstance } from 'class-transformer';
import type { AuthUser } from '../common/auth/auth.types.js';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  CompanySize,
  LeadSpecialDateType,
  LeadTemperature,
  LeadTimelineNoteType,
  PersonType,
  Prisma,
  TenantLeadStatus,
  TenantSector,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CreateTimelineNoteDto } from './dto/create-timeline-note.dto.js';
import { TIMELINE_NOTES_LIMIT } from './lead-detail.constants.js';
import type { LeadDetailRow } from './lead-detail.mapper.js';
import { LeadDetailService } from './lead-detail.service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OUTRO_TENANT_ID = '99999999-9999-4999-8999-999999999999';
const TENANT_LEAD_ID = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '33333333-3333-4333-8333-333333333333';
const STAGE_ID = '44444444-4444-4444-8444-444444444444';
const PRIMEIRA_ETAPA_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const OUTRO_USUARIO_ID = '77777777-7777-4777-8777-777777777777';
const CONTATO_ID = '88888888-8888-4888-8888-888888888888';
const DATA_ESPECIAL_ID = '99999999-9999-4999-8999-999999999998';
const NOTA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const CRIADO_EM = new Date('2026-10-10T12:00:00.000Z');
const CLAIMED_AT = new Date('2026-10-18T09:00:00.000Z');

/** Etapa de entrada do funil (`position: 1`) — destino da devolução ao Pool. */
const PRIMEIRA_ETAPA = {
  id: PRIMEIRA_ETAPA_ID,
  tenantId: TENANT_ID,
  name: 'Novo lead',
  code: 'NOVO',
  position: 1,
  colorHex: '#64748B',
  isLostStage: false,
  createdAt: CRIADO_EM,
  updatedAt: CRIADO_EM,
};

const vendedor: AuthUser = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  sessionId: 'sess-vendedor',
  role: 'USUARIO',
  operationalRole: 'VENDEDOR',
};

const administrador: AuthUser = {
  ...vendedor,
  sessionId: 'sess-admin',
  role: 'ADMIN',
  operationalRole: 'ADMIN',
};

/** `TenantLead` com todas as relações que o `include` da gaveta carrega. */
function linhaDoLead(overrides: Record<string, unknown> = {}): LeadDetailRow {
  return {
    id: TENANT_LEAD_ID,
    tenantId: TENANT_ID,
    leadId: LEAD_ID,
    stageId: STAGE_ID,
    assignedUserId: USER_ID,
    creatorUserId: null,
    status: TenantLeadStatus.CLAIMED,
    ticketValue: new Prisma.Decimal('35000.50'),
    closeProbability: 60,
    expectedCloseDate: new Date('2026-12-01T00:00:00.000Z'),
    proposalScope: 'Proposta 45 dias',
    lossReasonCode: null,
    lossReasonNotes: null,
    version: 3,
    lastContactAt: new Date('2026-10-20T12:00:00.000Z'),
    claimedAt: CLAIMED_AT,
    createdAt: CRIADO_EM,
    updatedAt: CRIADO_EM,
    stage: {
      id: STAGE_ID,
      tenantId: TENANT_ID,
      name: 'Em negociação',
      code: 'NEGOCIACAO',
      position: 3,
      colorHex: '#2563EB',
      isLostStage: false,
      createdAt: CRIADO_EM,
      updatedAt: CRIADO_EM,
    },
    assignedUser: {
      id: USER_ID,
      name: 'Ana Vendedora',
      email: 'ana@netprofissionais.com.br',
    },
    lead: {
      id: LEAD_ID,
      personType: PersonType.PJ,
      cnpj: '12345678000190',
      cpf: null,
      companyName: 'Eletro Minas Distribuidora LTDA',
      tradeName: 'Eletro Minas',
      primaryCnae: '4643-1/00',
      cnaeDescription: 'Comércio atacadista de material elétrico',
      capitalSocial: new Prisma.Decimal('120000.00'),
      postalCode: '01310-100',
      street: 'Avenida Paulista',
      number: '1000',
      complement: 'Sala 52',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      sector: TenantSector.OUTROS,
      companySize: CompanySize.EPP,
      temperature: LeadTemperature.QUENTE,
      temperatureScore: 80,
      createdAt: CRIADO_EM,
      updatedAt: CRIADO_EM,
      contacts: [
        {
          id: CONTATO_ID,
          tenantId: TENANT_ID,
          leadId: LEAD_ID,
          name: 'Carlos Alberto de Souza',
          role: 'Gerente de Suprimentos',
          phone: '11987654321',
          email: 'carlos.compras@eletrominas.com.br',
          birthday: new Date('1985-06-15T00:00:00.000Z'),
          isPrimary: true,
          isDecisionMaker: true,
          createdAt: CRIADO_EM,
          updatedAt: CRIADO_EM,
        },
      ],
      specialDates: [
        {
          id: DATA_ESPECIAL_ID,
          tenantId: TENANT_ID,
          leadId: LEAD_ID,
          dateType: LeadSpecialDateType.ANIVERSARIO_EMPRESA,
          dayMonth: '15/06',
          description: 'Aniversário de fundação',
          createdAt: CRIADO_EM,
        },
      ],
    },
    timelineNotes: [
      {
        id: NOTA_ID,
        tenantLeadId: TENANT_LEAD_ID,
        userId: USER_ID,
        type: LeadTimelineNoteType.CALL,
        title: 'Ligação',
        content: 'Cliente pediu a proposta revisada.',
        createdAt: new Date('2026-10-27T14:30:00.000Z'),
        user: { id: USER_ID, name: 'Ana Vendedora' },
      },
    ],
    ...overrides,
  } as unknown as LeadDetailRow;
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

describe('LeadDetailService', () => {
  let prisma: {
    tenantLead: { findFirst: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let tx: {
    leadTimelineNote: { create: ReturnType<typeof vi.fn> };
    tenantLead: { update: ReturnType<typeof vi.fn> };
    stage: { findFirst: ReturnType<typeof vi.fn> };
  };
  let service: LeadDetailService;

  beforeEach(() => {
    tx = {
      leadTimelineNote: { create: vi.fn() },
      tenantLead: { update: vi.fn() },
      stage: { findFirst: vi.fn() },
    };
    prisma = {
      tenantLead: { findFirst: vi.fn() },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    service = new LeadDetailService(prisma as unknown as PrismaService);
  });

  /** Mocks do caminho de `POST /leads/:id/timeline-notes`. */
  function prepararNota(): void {
    prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());
    tx.leadTimelineNote.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        id: 'nota-nova',
        createdAt: new Date('2026-10-28T10:00:00.000Z'),
        user: { id: USER_ID, name: 'Ana Vendedora' },
      }),
    );
    tx.tenantLead.update.mockResolvedValue({});
  }

  describe('GET /leads/:id — as 3 abas da gaveta', () => {
    it('devolve timeline, contatos, datas especiais e dados fiscais num só objeto @spec:AC-099', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());

      const detalhe = await service.getDetail(TENANT_LEAD_ID, vendedor);

      expect(Object.keys(detalhe).sort()).toEqual(
        [
          'assigned_user',
          'close_probability',
          'contacts',
          'expected_close_date',
          'fiscal',
          'id',
          'last_contact_at',
          'lead',
          'loss_reason_code',
          'loss_reason_notes',
          'proposal_scope',
          'special_dates',
          'stage',
          'status',
          'ticket_value',
          'timeline',
          'version',
        ].sort(),
      );

      expect(detalhe.stage).toEqual({
        id: STAGE_ID,
        name: 'Em negociação',
        code: 'NEGOCIACAO',
        position: 3,
        color_hex: '#2563EB',
        is_lost_stage: false,
      });
      expect(detalhe.assigned_user).toEqual({
        id: USER_ID,
        name: 'Ana Vendedora',
        email: 'ana@netprofissionais.com.br',
      });

      // Aba 1 — linha do tempo.
      expect(detalhe.timeline).toEqual([
        {
          id: NOTA_ID,
          type: 'CALL',
          title: 'Ligação',
          content: 'Cliente pediu a proposta revisada.',
          created_at: new Date('2026-10-27T14:30:00.000Z'),
          user: { id: USER_ID, name: 'Ana Vendedora' },
        },
      ]);

      // Aba 2 — contatos, com link de WhatsApp já com DDI 55.
      expect(detalhe.contacts).toEqual([
        {
          id: CONTATO_ID,
          name: 'Carlos Alberto de Souza',
          role: 'Gerente de Suprimentos',
          phone: '11987654321',
          email: 'carlos.compras@eletrominas.com.br',
          birthday: new Date('1985-06-15T00:00:00.000Z'),
          is_primary: true,
          is_decision_maker: true,
          whatsapp_url:
            'https://web.whatsapp.com/send?phone=5511987654321&text=Ol%C3%A1%2C%20Carlos!',
        },
      ]);
      expect(detalhe.special_dates).toEqual([
        {
          id: DATA_ESPECIAL_ID,
          date_type: 'ANIVERSARIO_EMPRESA',
          day_month: '15/06',
          description: 'Aniversário de fundação',
        },
      ]);

      // Aba 3 — dados fiscais da Receita (repetem a identidade do Lead).
      expect(detalhe.fiscal).toEqual({
        cnpj: '12345678000190',
        company_name: 'Eletro Minas Distribuidora LTDA',
        trade_name: 'Eletro Minas',
        primary_cnae: '4643-1/00',
        cnae_description: 'Comércio atacadista de material elétrico',
        capital_social: 120000,
        company_size: 'EPP',
        state: 'SP',
        city: 'São Paulo',
        sector: 'OUTROS',
      });
    });

    it('filtra contatos e datas especiais pelo tenantId da sessão @spec:AC-100', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());

      await service.getDetail(TENANT_LEAD_ID, vendedor);

      expect(prisma.tenantLead.findFirst).toHaveBeenCalledWith({
        where: { id: TENANT_LEAD_ID, tenantId: TENANT_ID },
        include: expect.objectContaining({
          lead: {
            include: {
              contacts: {
                where: { tenantId: TENANT_ID },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
              specialDates: {
                where: { tenantId: TENANT_ID },
                orderBy: [{ dayMonth: 'asc' }],
              },
            },
          },
        }),
      });
    });

    it('converte Decimal em number na resposta @spec:AC-103', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());

      const detalhe = await service.getDetail(TENANT_LEAD_ID, vendedor);

      expect(detalhe.ticket_value).toBe(35000.5);
      expect(typeof detalhe.ticket_value).toBe('number');
      expect(detalhe.fiscal.capital_social).toBe(120000);
      expect(typeof detalhe.fiscal.capital_social).toBe('number');
    });

    it('mantém null quando o Decimal não foi preenchido', async () => {
      const linha = linhaDoLead();
      linha.ticketValue = null;
      linha.lead.capitalSocial = null;
      prisma.tenantLead.findFirst.mockResolvedValue(linha);

      const detalhe = await service.getDetail(TENANT_LEAD_ID, vendedor);

      expect(detalhe.ticket_value).toBeNull();
      expect(detalhe.fiscal.capital_social).toBeNull();
    });

    it('responde 404 LEAD_NOT_FOUND para id fora do formato UUID (não 500) @spec:AC-101', async () => {
      await expectBusinessError(
        service.getDetail('nao-e-um-uuid', vendedor),
        404,
        'LEAD_NOT_FOUND',
      );

      // O Postgres estouraria na coluna `uuid`: a validação acontece antes.
      expect(prisma.tenantLead.findFirst).not.toHaveBeenCalled();
    });

    it('responde 404 LEAD_NOT_FOUND para lead de outro tenant', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.getDetail(TENANT_LEAD_ID, { ...vendedor, tenantId: OUTRO_TENANT_ID }),
        404,
        'LEAD_NOT_FOUND',
      );

      expect(prisma.tenantLead.findFirst).toHaveBeenCalledWith({
        where: { id: TENANT_LEAD_ID, tenantId: OUTRO_TENANT_ID },
        include: expect.any(Object),
      });
    });

    it('responde 403 FORBIDDEN quando o VENDEDOR abre lead de outro vendedor @spec:AC-102', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(
        linhaDoLead({ assignedUserId: OUTRO_USUARIO_ID }),
      );

      await expectBusinessError(
        service.getDetail(TENANT_LEAD_ID, vendedor),
        403,
        'FORBIDDEN',
      );
    });

    it('permite que o Administrador leia lead de qualquer vendedor do tenant', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(
        linhaDoLead({ assignedUserId: OUTRO_USUARIO_ID }),
      );

      await expect(service.getDetail(TENANT_LEAD_ID, administrador)).resolves.toMatchObject({
        id: TENANT_LEAD_ID,
      });
    });

    it('ordena a timeline por createdAt desc e limita a 100 notas @spec:AC-105', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());

      await service.getDetail(TENANT_LEAD_ID, vendedor);

      const include = prisma.tenantLead.findFirst.mock.calls[0][0].include as Record<
        string,
        unknown
      >;

      expect(include.timelineNotes).toEqual({
        orderBy: { createdAt: 'desc' },
        take: TIMELINE_NOTES_LIMIT,
        include: { user: { select: { id: true, name: true } } },
      });
      expect(TIMELINE_NOTES_LIMIT).toBe(100);
    });
  });

  describe('POST /leads/:id/timeline-notes', () => {
    it('normaliza o type minúsculo do contrato e usa o título padrão do tipo', async () => {
      prepararNota();

      // É o que o `ValidationPipe` entrega ao service: `@Transform` no DTO.
      const dto = plainToInstance(CreateTimelineNoteDto, {
        type: 'call',
        content: 'Cliente pediu reenvio da proposta.',
      });

      expect(dto.type).toBe('CALL');

      const nota = await service.createTimelineNote(TENANT_LEAD_ID, vendedor, dto);

      expect(tx.leadTimelineNote.create).toHaveBeenCalledWith({
        data: {
          tenantLeadId: TENANT_LEAD_ID,
          userId: USER_ID,
          type: LeadTimelineNoteType.CALL,
          title: 'Ligação',
          content: 'Cliente pediu reenvio da proposta.',
        },
        include: { user: { select: { id: true, name: true } } },
      });
      expect(nota).toEqual({
        id: 'nota-nova',
        type: 'CALL',
        title: 'Ligação',
        content: 'Cliente pediu reenvio da proposta.',
        created_at: new Date('2026-10-28T10:00:00.000Z'),
        user: { id: USER_ID, name: 'Ana Vendedora' },
      });
    });

    it.each([
      ['note', 'Nota'],
      ['call', 'Ligação'],
      ['meeting', 'Reunião'],
    ])('usa o título padrão de %s quando o título não é enviado', async (tipo, titulo) => {
      prepararNota();
      const dto = plainToInstance(CreateTimelineNoteDto, {
        type: tipo,
        content: 'Interação registrada pelo vendedor.',
      });

      await service.createTimelineNote(TENANT_LEAD_ID, vendedor, dto);

      expect(tx.leadTimelineNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: titulo }),
        }),
      );
    });

    it('grava a nota e atualiza lastContactAt na mesma transação @spec:AC-104', async () => {
      prepararNota();
      vi.useFakeTimers({ now: new Date('2026-10-28T10:00:00.000Z') });

      try {
        const dto = plainToInstance(CreateTimelineNoteDto, {
          type: 'note',
          title: 'Retorno do cliente',
          content: 'Confirmou a visita técnica.',
        });

        await service.createTimelineNote(TENANT_LEAD_ID, vendedor, dto);
      } finally {
        vi.useRealTimers();
      }

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.tenantLead.update).toHaveBeenCalledWith({
        where: { id: TENANT_LEAD_ID, tenantId: TENANT_ID },
        data: {
          lastContactAt: new Date('2026-10-28T10:00:00.000Z'),
          version: { increment: 1 },
        },
      });
    });

    it('usa contacted_at como data do contato quando o vendedor informa', async () => {
      prepararNota();
      const dto = plainToInstance(CreateTimelineNoteDto, {
        type: 'meeting',
        content: 'Reunião na sede do cliente.',
        contacted_at: '2026-10-27T14:30:00.000Z',
      });

      await service.createTimelineNote(TENANT_LEAD_ID, vendedor, dto);

      expect(tx.tenantLead.update).toHaveBeenCalledWith({
        where: { id: TENANT_LEAD_ID, tenantId: TENANT_ID },
        data: {
          lastContactAt: new Date('2026-10-27T14:30:00.000Z'),
          version: { increment: 1 },
        },
      });
    });

    it.each([
      ['sem título e sem conteúdo', { type: 'note' }],
      ['só com espaços', { type: 'note', title: '   ', content: '  ' }],
    ])('responde 400 VALIDATION_ERROR %s, sem gravar', async (_caso, corpo) => {
      prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());
      const dto = plainToInstance(CreateTimelineNoteDto, corpo);

      await expectBusinessError(
        service.createTimelineNote(TENANT_LEAD_ID, vendedor, dto),
        400,
        'VALIDATION_ERROR',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.leadTimelineNote.create).not.toHaveBeenCalled();
    });

    it('responde 403 FORBIDDEN quando o VENDEDOR registra nota em lead de outro', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(
        linhaDoLead({ assignedUserId: OUTRO_USUARIO_ID }),
      );
      const dto = plainToInstance(CreateTimelineNoteDto, {
        type: 'note',
        content: 'Tentativa indevida.',
      });

      await expectBusinessError(
        service.createTimelineNote(TENANT_LEAD_ID, vendedor, dto),
        403,
        'FORBIDDEN',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('POST /leads/:id/unlink', () => {
    it.each([TenantLeadStatus.AVAILABLE, TenantLeadStatus.RETURNED_TO_POOL])(
      'responde 409 CONFLICT para lead já no Pool (status %s)',
      async (status) => {
        prisma.tenantLead.findFirst.mockResolvedValue(
          linhaDoLead({ status, assignedUserId: USER_ID }),
        );

        await expectBusinessError(
          service.unlink(TENANT_LEAD_ID, vendedor, {}),
          409,
          'CONFLICT',
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it.each([TenantLeadStatus.CLAIMED, TenantLeadStatus.LOST])(
      'devolve ao Pool o lead em %s: sem responsável, primeira etapa, version+1 e claimedAt preservado @spec:AC-106',
      async (status) => {
        prisma.tenantLead.findFirst
          .mockResolvedValueOnce(linhaDoLead({ status }))
          .mockResolvedValueOnce(
            linhaDoLead({
              status: TenantLeadStatus.RETURNED_TO_POOL,
              assignedUserId: null,
              assignedUser: null,
              stageId: PRIMEIRA_ETAPA_ID,
              stage: PRIMEIRA_ETAPA,
              version: 4,
              lossReasonCode: null,
              lossReasonNotes: null,
            }),
          );
        tx.stage.findFirst.mockResolvedValue({ id: PRIMEIRA_ETAPA_ID });
        tx.tenantLead.update.mockResolvedValue({});
        tx.leadTimelineNote.create.mockResolvedValue({ id: 'nota-devolucao' });

        const detalhe = await service.unlink(TENANT_LEAD_ID, vendedor, {
          reason: 'Carteira cheia: preciso priorizar as propostas.',
        });

        // Primeira etapa do funil (menor `position`).
        expect(tx.stage.findFirst).toHaveBeenCalledWith({
          where: { tenantId: TENANT_ID },
          orderBy: { position: 'asc' },
          select: { id: true },
        });

        expect(tx.tenantLead.update).toHaveBeenCalledWith({
          where: { id: TENANT_LEAD_ID, tenantId: TENANT_ID },
          data: {
            status: TenantLeadStatus.RETURNED_TO_POOL,
            assignedUserId: null,
            stageId: PRIMEIRA_ETAPA_ID,
            lossReasonCode: null,
            lossReasonNotes: null,
            version: { increment: 1 },
          },
        });

        // `claimedAt` é a base da cota diária de captação: devolver não apaga.
        expect(tx.tenantLead.update.mock.calls[0][0].data).not.toHaveProperty('claimedAt');

        // A devolução fica registrada na timeline com o motivo do vendedor.
        expect(tx.leadTimelineNote.create).toHaveBeenCalledWith({
          data: {
            tenantLeadId: TENANT_LEAD_ID,
            userId: USER_ID,
            type: LeadTimelineNoteType.STATUS_CHANGE,
            title: 'Lead devolvido ao pool',
            content: 'Carteira cheia: preciso priorizar as propostas.',
          },
        });

        expect(detalhe.status).toBe(TenantLeadStatus.RETURNED_TO_POOL);
        expect(detalhe.assigned_user).toBeNull();
        expect(detalhe.stage.id).toBe(PRIMEIRA_ETAPA_ID);
        expect(detalhe.version).toBe(4);
        expect(detalhe.loss_reason_code).toBeNull();
      },
    );

    it('usa o texto padrão da devolução quando o motivo não é informado', async () => {
      prisma.tenantLead.findFirst
        .mockResolvedValueOnce(linhaDoLead())
        .mockResolvedValueOnce(
          linhaDoLead({ status: TenantLeadStatus.RETURNED_TO_POOL, assignedUserId: null }),
        );
      tx.stage.findFirst.mockResolvedValue({ id: PRIMEIRA_ETAPA_ID });
      tx.tenantLead.update.mockResolvedValue({});
      tx.leadTimelineNote.create.mockResolvedValue({ id: 'nota-devolucao' });

      await service.unlink(TENANT_LEAD_ID, vendedor, {});

      expect(tx.leadTimelineNote.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: LeadTimelineNoteType.STATUS_CHANGE,
          content:
            'Vendedor se desvinculou do lead. Devolvido ao Pool para redistribuição.',
        }),
      });
    });

    it('responde 403 FORBIDDEN quando o lead é de outro vendedor', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(
        linhaDoLead({ assignedUserId: OUTRO_USUARIO_ID }),
      );

      await expectBusinessError(
        service.unlink(TENANT_LEAD_ID, vendedor, {}),
        403,
        'FORBIDDEN',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('permite que o Administrador devolva lead de outro vendedor', async () => {
      prisma.tenantLead.findFirst
        .mockResolvedValueOnce(linhaDoLead({ assignedUserId: OUTRO_USUARIO_ID }))
        .mockResolvedValueOnce(
          linhaDoLead({ status: TenantLeadStatus.RETURNED_TO_POOL, assignedUserId: null }),
        );
      tx.stage.findFirst.mockResolvedValue({ id: PRIMEIRA_ETAPA_ID });
      tx.tenantLead.update.mockResolvedValue({});
      tx.leadTimelineNote.create.mockResolvedValue({ id: 'nota-devolucao' });

      await expect(service.unlink(TENANT_LEAD_ID, administrador, {})).resolves.toMatchObject({
        status: TenantLeadStatus.RETURNED_TO_POOL,
      });
    });

    it('responde 422 STAGE_NOT_CONFIGURED quando o tenant não tem etapas', async () => {
      prisma.tenantLead.findFirst.mockResolvedValue(linhaDoLead());
      tx.stage.findFirst.mockResolvedValue(null);

      await expectBusinessError(
        service.unlink(TENANT_LEAD_ID, vendedor, {}),
        422,
        'STAGE_NOT_CONFIGURED',
      );

      expect(tx.tenantLead.update).not.toHaveBeenCalled();
    });

    it('responde 404 LEAD_NOT_FOUND para id malformado', async () => {
      await expectBusinessError(
        service.unlink('123', vendedor, {}),
        404,
        'LEAD_NOT_FOUND',
      );

      expect(prisma.tenantLead.findFirst).not.toHaveBeenCalled();
    });
  });
});

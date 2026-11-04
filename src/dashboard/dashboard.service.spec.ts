import type { AuthUser } from '../common/auth/auth.types.js';
import { LeadSpecialDateType, TenantLeadStatus } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Testes dos três dashboards (`02-A-D`, `02-B-D`, `02-C-D`).
 *
 * Sem banco: `PrismaService` é substituído por um dublê que devolve fixtures e
 * registra os `where` recebidos — é assim que se prova o escopo por tenant e
 * por vendedor sem tocar em PostgreSQL.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';

/** Uma chamada registrada pelo dublê. */
interface RecordedCall {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

/** Dublê de `PrismaService`: filas de respostas + registro das chamadas. */
class FakePrisma {
  readonly calls: RecordedCall[] = [];

  /** Catálogo devolvido por `stage.findMany`. */
  stages: Record<string, unknown>[] = [];

  /** Respostas de `tenantLead.findMany`, consumidas na ordem das chamadas. */
  leadPages: Record<string, unknown>[][] = [];

  /** Total devolvido por `tenantLead.count`. */
  taskTotal = 0;

  /** Linhas devolvidas por `leadSpecialDate.findMany`. */
  specialDates: Record<string, unknown>[] = [];

  readonly stage = {
    findMany: async (args: Record<string, unknown>) => {
      this.calls.push({ model: 'stage', method: 'findMany', args });
      return this.stages;
    },
  };

  readonly tenantLead = {
    findMany: async (args: Record<string, unknown>) => {
      this.calls.push({ model: 'tenantLead', method: 'findMany', args });
      return this.leadPages.shift() ?? [];
    },
    count: async (args: Record<string, unknown>) => {
      this.calls.push({ model: 'tenantLead', method: 'count', args });
      return this.taskTotal;
    },
  };

  readonly leadSpecialDate = {
    findMany: async (args: Record<string, unknown>) => {
      this.calls.push({ model: 'leadSpecialDate', method: 'findMany', args });
      return this.specialDates;
    },
  };

  async $transaction<T>(operations: Promise<T>[]): Promise<T[]> {
    return Promise.all(operations);
  }

  /** Chamadas de um modelo/método, na ordem em que ocorreram. */
  callsOf(model: string, method: string): RecordedCall[] {
    return this.calls.filter((call) => call.model === model && call.method === method);
  }

  /** Última chamada de um modelo/método. */
  lastCallOf(model: string, method: string): RecordedCall {
    const calls = this.callsOf(model, method);

    return calls[calls.length - 1];
  }
}

/** O `where` de uma chamada (o dublê só recebe `where`/`select`/`orderBy`). */
function whereOf(call: RecordedCall | undefined): Record<string, unknown> {
  return (call?.args.where ?? {}) as Record<string, unknown>;
}

/** Procura `tenantId: <valor>` em qualquer profundidade do filtro. */
function hasTenantFilter(value: unknown, tenantId: string): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasTenantFilter(item, tenantId));
  }

  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'tenantId' && inner === tenantId) {
      return true;
    }

    if (hasTenantFilter(inner, tenantId)) {
      return true;
    }
  }

  return false;
}

/** Catálogo do seed (7 etapas, ganho em `6_fechado_ganho`). */
const SEED_STAGES = [
  { id: 's1', name: 'Novo', code: '1_novo', position: 1, colorHex: '#111111', isLostStage: false },
  {
    id: 's2',
    name: 'Contato Inicial',
    code: '2_contato_inicial',
    position: 2,
    colorHex: '#222222',
    isLostStage: false,
  },
  {
    id: 's3',
    name: 'Qualificado',
    code: '3_qualificado',
    position: 3,
    colorHex: '#333333',
    isLostStage: false,
  },
  { id: 's4', name: 'Proposta', code: '4_proposta', position: 4, colorHex: '#444444', isLostStage: false },
  {
    id: 's5',
    name: 'Negociação',
    code: '5_negociacao',
    position: 5,
    colorHex: '#555555',
    isLostStage: false,
  },
  {
    id: 's6',
    name: 'Fechado Ganho',
    code: '6_fechado_ganho',
    position: 6,
    colorHex: '#666666',
    isLostStage: false,
  },
  {
    id: 's7',
    name: 'Perdido',
    code: '7_perdido',
    position: 7,
    colorHex: '#777777',
    isLostStage: true,
  },
];

const HOUR = 60 * 60 * 1000;

/** Contato recente em relação ao relógio real (o service usa `Date.now()`). */
function recentContact(): Date {
  return new Date(Date.now() - HOUR);
}

function adminUser(): AuthUser {
  return {
    userId: 'u-admin',
    tenantId: TENANT,
    sessionId: 'sess-admin',
    role: 'ADMIN',
    operationalRole: 'ADMIN',
  };
}

function sellerUser(userId = 'u-vendedor'): AuthUser {
  return {
    userId,
    tenantId: TENANT,
    sessionId: 'sess-vendedor',
    role: 'USUARIO',
    operationalRole: 'VENDEDOR',
  };
}

function captadorUser(): AuthUser {
  return {
    userId: 'u-captador',
    tenantId: TENANT,
    sessionId: 'sess-captador',
    role: 'USUARIO',
    operationalRole: 'CAPTADOR',
  };
}

/** Linha de lead no formato que o dashboard do administrador consome. */
function adminRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'lead',
    stageId: 's1',
    assignedUserId: null,
    status: TenantLeadStatus.AVAILABLE,
    ticketValue: null,
    lossReasonCode: null,
    lastContactAt: recentContact(),
    assignedUser: null,
    ...overrides,
  };
}

/** Linha de lead no formato que o dashboard do vendedor/captador consome. */
function sellerRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'lead',
    stageId: 's1',
    status: TenantLeadStatus.CLAIMED,
    ticketValue: null,
    lastContactAt: recentContact(),
    expectedCloseDate: null,
    lead: { companyName: 'Empresa', tradeName: null },
    stage: { name: 'Novo' },
    ...overrides,
  };
}

describe('DashboardService — GET /dashboard/admin', () => {
  let prisma: FakePrisma;
  let service: DashboardService;

  beforeEach(() => {
    prisma = new FakePrisma();
    prisma.stages = SEED_STAGES;
    service = new DashboardService(prisma as unknown as PrismaService);
  });

  /** Coorte com um lead em cada situação do funil. */
  function seedAdminCohort(): void {
    prisma.leadPages = [
      [
        // Em negociação: entra no pipeline.
        adminRow({
          id: 'l1',
          stageId: 's4',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          ticketValue: 10_000,
        }),
        // Em negociação e parado (sem contato): entra no pipeline e no alerta.
        adminRow({
          id: 'l2',
          stageId: 's5',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          ticketValue: 5_000.5,
          lastContactAt: null,
        }),
        // Ganho: não entra no pipeline (o valor já está em `won_total_value`).
        adminRow({
          id: 'l3',
          stageId: 's6',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u2',
          assignedUser: { id: 'u2', name: 'Bruno' },
          ticketValue: 20_000,
        }),
        // Perdido com motivo.
        adminRow({
          id: 'l4',
          stageId: 's7',
          status: TenantLeadStatus.LOST,
          assignedUserId: 'u2',
          assignedUser: { id: 'u2', name: 'Bruno' },
          ticketValue: 8_000,
          lossReasonCode: 'preco',
        }),
        // Pool: ninguém trabalha nele, então não é pipeline.
        adminRow({
          id: 'l5',
          stageId: 's1',
          status: TenantLeadStatus.AVAILABLE,
          ticketValue: 3_000,
        }),
        // Devolvido ao Pool: também fora do pipeline.
        adminRow({
          id: 'l6',
          stageId: 's2',
          status: TenantLeadStatus.RETURNED_TO_POOL,
          ticketValue: 1_500,
        }),
        // Perdido sem motivo preenchido: cai em `outro` no breakdown.
        adminRow({
          id: 'l7',
          stageId: 's3',
          status: TenantLeadStatus.LOST,
          ticketValue: 2_000,
        }),
      ],
    ];
  }

  it('consolida os KPIs da coorte do período @spec:AC-114', async () => {
    seedAdminCohort();

    const result = await service.getAdminDashboard(adminUser(), { period: 'this_month' });

    expect(result.kpis).toEqual({
      total_leads: 7,
      leads_in_pool: 2,
      leads_claimed: 3,
      leads_won: 1,
      leads_lost: 2,
      conversion_rate: 14.3,
      conversion_rate_basis: 'won_over_total',
      pipeline_total_value: 15_000.5,
      won_total_value: 20_000,
      average_ticket: 7_071.5,
      inactivity_alerts: 1,
    });
  });

  it('devolve o funil com as 7 etapas do tenant, na ordem do catálogo @spec:AC-115', async () => {
    seedAdminCohort();

    const result = await service.getAdminDashboard(adminUser(), {});

    expect(result.funnel).toHaveLength(7);
    expect(result.funnel.map((entry) => entry.code)).toEqual(
      SEED_STAGES.map((stage) => stage.code),
    );
    expect(result.funnel.map((entry) => entry.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(result.funnel.find((entry) => entry.stage_id === 's6')).toMatchObject({
      stage_name: 'Fechado Ganho',
      position: 6,
      color_hex: '#666666',
      count: 1,
      total_value: 20_000,
    });
  });

  it('entrega o breakdown de perdas com percentual sobre os perdidos @spec:AC-116', async () => {
    seedAdminCohort();

    const result = await service.getAdminDashboard(adminUser(), {});

    expect(result.loss_reasons).toHaveLength(6);
    expect(result.loss_reasons.find((entry) => entry.code === 'preco')).toMatchObject({
      count: 1,
      percentage: 50,
    });
    expect(result.loss_reasons.find((entry) => entry.code === 'outro')).toMatchObject({
      count: 1,
      percentage: 50,
    });
    expect(result.loss_reasons.find((entry) => entry.code === 'timing')).toMatchObject({
      count: 0,
      percentage: 0,
    });
    expect(result.loss_reasons.reduce((total, entry) => total + entry.percentage, 0)).toBe(100);
  });

  it('agrupa a produtividade por vendedor, ordenada pelo valor @spec:AC-117', async () => {
    seedAdminCohort();

    const result = await service.getAdminDashboard(adminUser(), {});

    expect(result.sellers).toEqual([
      { user_id: 'u2', name: 'Bruno', claimed_count: 2, won_count: 1, total_value: 20_000 },
      { user_id: 'u1', name: 'Ana', claimed_count: 2, won_count: 0, total_value: 15_000.5 },
    ]);
  });

  it('devolve o período resolvido no payload', async () => {
    seedAdminCohort();

    const result = await service.getAdminDashboard(adminUser(), { period: 'this_month' });

    expect(result.period.label).toBe('Mês corrente');
    expect(result.period.from.getDate()).toBe(1);
    expect(result.period.from.getHours()).toBe(0);
    expect(result.period.to.getHours()).toBe(23);
    expect(result.period.to.getMinutes()).toBe(59);
  });

  it('`pipeline_total_value` exclui Pool, perdidos e etapas de ganho @spec:AC-118', async () => {
    prisma.leadPages = [
      [
        adminRow({
          id: 'pool',
          status: TenantLeadStatus.AVAILABLE,
          assignedUserId: null,
          ticketValue: 3_000,
        }),
        adminRow({
          id: 'ganho',
          stageId: 's6',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          ticketValue: 20_000,
        }),
        adminRow({
          id: 'perdido',
          stageId: 's7',
          status: TenantLeadStatus.LOST,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          ticketValue: 8_000,
        }),
        adminRow({
          id: 'negociacao',
          stageId: 's4',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          ticketValue: 1_000,
        }),
      ],
    ];

    const result = await service.getAdminDashboard(adminUser(), {});

    expect(result.kpis.pipeline_total_value).toBe(1_000);
    expect(result.kpis.won_total_value).toBe(20_000);
  });

  it('`inactivity_alerts` conta só lead em carteira, em aberto e parado @spec:AC-119', async () => {
    prisma.leadPages = [
      [
        // Conta: em carteira, em aberto e sem contato há mais de 48h.
        adminRow({
          id: 'alerta',
          stageId: 's4',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          lastContactAt: new Date(Date.now() - 49 * HOUR),
        }),
        // Não conta: contato recente.
        adminRow({
          id: 'recente',
          stageId: 's4',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
        }),
        // Não conta: Pool (ninguém pode resolver).
        adminRow({
          id: 'pool',
          status: TenantLeadStatus.AVAILABLE,
          lastContactAt: null,
        }),
        // Não conta: perdido.
        adminRow({
          id: 'perdido',
          stageId: 's7',
          status: TenantLeadStatus.LOST,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          lastContactAt: null,
        }),
        // Não conta: já ganho.
        adminRow({
          id: 'ganho',
          stageId: 's6',
          status: TenantLeadStatus.CLAIMED,
          assignedUserId: 'u1',
          assignedUser: { id: 'u1', name: 'Ana' },
          lastContactAt: null,
        }),
      ],
    ];

    const result = await service.getAdminDashboard(adminUser(), {});

    expect(result.kpis.inactivity_alerts).toBe(1);
  });

  it('devolve KPIs zerados (sem `NaN`) quando não há leads no período', async () => {
    prisma.leadPages = [[]];

    const result = await service.getAdminDashboard(adminUser(), {});

    expect(result.kpis.total_leads).toBe(0);
    expect(result.kpis.conversion_rate).toBe(0);
    expect(result.kpis.average_ticket).toBe(0);
    expect(result.kpis.pipeline_total_value).toBe(0);
    expect(result.funnel).toHaveLength(7);
    expect(result.sellers).toEqual([]);
  });

  it('filtra etapas e leads pelo tenant da sessão', async () => {
    seedAdminCohort();

    await service.getAdminDashboard(adminUser(), {});

    expect(whereOf(prisma.callsOf('stage', 'findMany')[0]).tenantId).toBe(TENANT);
    expect(whereOf(prisma.callsOf('tenantLead', 'findMany')[0]).tenantId).toBe(TENANT);
    // O tenant nunca vem da query, mesmo que o cliente tente injetar.
    expect(
      whereOf(prisma.callsOf('tenantLead', 'findMany')[0]).tenantId,
    ).not.toBe(OTHER_TENANT);
  });
});

describe('DashboardService — GET /dashboard/seller', () => {
  let prisma: FakePrisma;
  let service: DashboardService;

  beforeEach(() => {
    prisma = new FakePrisma();
    prisma.stages = SEED_STAGES;
    service = new DashboardService(prisma as unknown as PrismaService);
  });

  function seedSellerCarteira(): void {
    prisma.leadPages = [
      [
        sellerRow({ id: 'sl1', stageId: 's4', ticketValue: 1_000 }),
        sellerRow({ id: 'sl2', stageId: 's6', ticketValue: 4_000 }),
        sellerRow({ id: 'sl3', stageId: 's7', status: TenantLeadStatus.LOST, ticketValue: 500 }),
      ],
    ];
  }

  it('calcula os KPIs da própria carteira', async () => {
    seedSellerCarteira();

    const result = await service.getSellerDashboard(sellerUser(), {});

    expect(result.kpis).toMatchObject({
      my_leads: 3,
      my_won: 1,
      my_lost: 1,
      my_conversion_rate: 33.3,
      my_conversion_rate_basis: 'won_over_total',
      my_pipeline_value: 1_000,
      my_won_value: 4_000,
    });
    expect(result.my_funnel).toHaveLength(7);
  });

  it('ignora o `assigned_user_id` do cliente e usa o `user.userId` da sessão @spec:AC-122', async () => {
    seedSellerCarteira();

    await service.getSellerDashboard(
      sellerUser('u-vendedor'),
      { assigned_user_id: 'u-outro-vendedor' } as never,
    );

    const [carteira] = prisma.callsOf('tenantLead', 'findMany');

    expect(whereOf(carteira).assignedUserId).toBe('u-vendedor');
    expect(whereOf(carteira).assignedUserId).not.toBe('u-outro-vendedor');
  });

  it('limita a lista de tarefas a 20 mas informa o total real de pendências @spec:AC-123', async () => {
    seedSellerCarteira();
    prisma.leadPages.push(
      Array.from({ length: 20 }, (_, index) =>
        sellerRow({
          id: `task-${index}`,
          expectedCloseDate: new Date(Date.now() - 24 * HOUR),
        }),
      ),
    );
    prisma.taskTotal = 45;

    const result = await service.getSellerDashboard(sellerUser(), {});

    expect(result.today_tasks).toHaveLength(20);
    expect(result.kpis.today_tasks).toBe(20);
    expect(result.kpis.today_tasks_total).toBe(45);

    const [, tarefas] = prisma.callsOf('tenantLead', 'findMany');
    const contagem = prisma.lastCallOf('tenantLead', 'count');

    expect(tarefas.args.take).toBe(20);
    // A contagem usa o mesmo `where` e **não** herda o teto da listagem.
    expect(contagem.args.where).toEqual(tarefas.args.where);
    expect(contagem.args.take).toBeUndefined();
  });

  it('monta a agenda com o motivo real de cada lead @spec:AC-124', async () => {
    seedSellerCarteira();
    prisma.leadPages.push([
      sellerRow({
        id: 'vencido',
        expectedCloseDate: new Date(Date.now() - 3 * 24 * HOUR),
        lead: { companyName: 'Solar Vencida', tradeName: null },
        stage: { name: 'Proposta' },
      }),
    ]);

    const result = await service.getSellerDashboard(sellerUser(), {});

    expect(result.today_tasks[0]).toMatchObject({
      tenant_lead_id: 'vencido',
      company_name: 'Solar Vencida',
      stage_name: 'Proposta',
    });
    expect(result.today_tasks[0].reason).toContain('vencida');
  });

  it('escopa a agenda ao vendedor e deixa perdidos de fora', async () => {
    seedSellerCarteira();
    prisma.leadPages.push([]);

    await service.getSellerDashboard(sellerUser('u-vendedor'), {});

    const [, tarefas] = prisma.callsOf('tenantLead', 'findMany');
    const where = whereOf(tarefas);

    expect(where.tenantId).toBe(TENANT);
    expect(where.assignedUserId).toBe('u-vendedor');
    expect(where.status).toEqual({ not: TenantLeadStatus.LOST });
    expect(Array.isArray(where.OR)).toBe(true);
    // A agenda é uma lista de "agora": o `period` da tela não a recorta.
    expect(where.createdAt).toBeUndefined();
  });

  it('lista aniversariantes da janela de 7 dias com `is_today` correto', async () => {
    seedSellerCarteira();
    prisma.leadPages.push([]);

    const today = new Date();
    const dayMonth = (offset: number): string => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);

      return `${String(date.getDate()).padStart(2, '0')}/${String(
        date.getMonth() + 1,
      ).padStart(2, '0')}`;
    };

    prisma.specialDates = [
      {
        leadId: 'lead-hoje',
        dateType: LeadSpecialDateType.ANIVERSARIO_SOCIO,
        dayMonth: dayMonth(0),
        lead: {
          companyName: 'Solar Hoje',
          tradeName: null,
          contacts: [{ name: 'Maria Souza' }],
        },
      },
      {
        leadId: 'lead-sete',
        dateType: LeadSpecialDateType.ANIVERSARIO_EMPRESA,
        dayMonth: dayMonth(7),
        lead: { companyName: null, tradeName: 'Fantasia Sete', contacts: [] },
      },
      {
        leadId: 'lead-fora',
        dateType: LeadSpecialDateType.ANIVERSARIO_EMPRESA,
        dayMonth: dayMonth(8),
        lead: { companyName: 'Fora da Janela', tradeName: null, contacts: [] },
      },
    ];

    const result = await service.getSellerDashboard(sellerUser(), {});

    expect(result.birthdays).toHaveLength(2);
    expect(result.birthdays[0]).toMatchObject({
      lead_id: 'lead-hoje',
      company_name: 'Solar Hoje',
      contact_name: 'Maria Souza',
      date_type: LeadSpecialDateType.ANIVERSARIO_SOCIO,
      days_until: 0,
      is_today: true,
    });
    expect(result.birthdays[1]).toMatchObject({
      lead_id: 'lead-sete',
      company_name: 'Fantasia Sete',
      // Aniversário da empresa não tem pessoa associada.
      contact_name: null,
      days_until: 7,
      is_today: false,
    });
  });

  it('filtra aniversários e agenda pelo tenant e pelo vendedor da sessão', async () => {
    seedSellerCarteira();
    prisma.leadPages.push([]);

    await service.getSellerDashboard(sellerUser('u-vendedor'), {});

    const especial = whereOf(prisma.lastCallOf('leadSpecialDate', 'findMany'));

    expect(hasTenantFilter(especial, TENANT)).toBe(true);
    expect(JSON.stringify(especial)).toContain('u-vendedor');
  });
});

describe('DashboardService — GET /dashboard/captador', () => {
  let prisma: FakePrisma;
  let service: DashboardService;

  beforeEach(() => {
    prisma = new FakePrisma();
    prisma.stages = SEED_STAGES;
    service = new DashboardService(prisma as unknown as PrismaService);
  });

  function seedCaptacoes(): void {
    prisma.leadPages = [
      [
        sellerRow({
          id: 'cl1',
          stageId: 's1',
          status: TenantLeadStatus.AVAILABLE,
          ticketValue: 1_000,
        }),
        sellerRow({
          id: 'cl2',
          stageId: 's4',
          status: TenantLeadStatus.CLAIMED,
          ticketValue: 2_000,
        }),
        sellerRow({
          id: 'cl3',
          stageId: 's6',
          status: TenantLeadStatus.CLAIMED,
          ticketValue: 3_000,
        }),
        sellerRow({
          id: 'cl4',
          stageId: 's7',
          status: TenantLeadStatus.LOST,
          ticketValue: 500,
        }),
      ],
      [
        {
          id: 'cl4',
          status: TenantLeadStatus.LOST,
          createdAt: new Date(2026, 9, 27, 10, 0, 0),
          lead: { companyName: null, tradeName: 'Fantasia Recente' },
        },
      ],
    ];
  }

  it('CAPTADOR vê apenas o que ele mesmo criou @spec:AC-126', async () => {
    seedCaptacoes();

    const result = await service.getCaptadorDashboard(captadorUser(), {});

    expect(result.kpis).toEqual({
      captured_total: 4,
      captured_in_pool: 1,
      captured_claimed: 2,
      captured_won: 1,
      conversion_rate: 25,
      conversion_rate_basis: 'won_over_total',
      captured_total_value: 6_000,
    });

    const [captacoes, recentes] = prisma.callsOf('tenantLead', 'findMany');

    expect(whereOf(captacoes)).toMatchObject({
      tenantId: TENANT,
      creatorUserId: 'u-captador',
    });
    expect(whereOf(recentes)).toMatchObject({
      tenantId: TENANT,
      creatorUserId: 'u-captador',
    });
  });

  it('ADMIN vê o tenant inteiro (sem recorte de criador)', async () => {
    seedCaptacoes();

    await service.getCaptadorDashboard(adminUser(), {});

    const [captacoes] = prisma.callsOf('tenantLead', 'findMany');

    expect(whereOf(captacoes).tenantId).toBe(TENANT);
    expect(whereOf(captacoes).creatorUserId).toBeUndefined();
  });

  it('distribui as captações por status na ordem da esteira', async () => {
    seedCaptacoes();

    const result = await service.getCaptadorDashboard(captadorUser(), {});

    expect(result.by_status).toEqual([
      { status: TenantLeadStatus.AVAILABLE, count: 1 },
      { status: TenantLeadStatus.CLAIMED, count: 2 },
      { status: TenantLeadStatus.RETURNED_TO_POOL, count: 0 },
      { status: TenantLeadStatus.LOST, count: 1 },
    ]);
  });

  it('lista as 10 captações mais recentes, sem recorte de período', async () => {
    seedCaptacoes();

    const result = await service.getCaptadorDashboard(captadorUser(), {
      period: 'today',
    });

    expect(result.recent).toEqual([
      {
        tenant_lead_id: 'cl4',
        company_name: 'Fantasia Recente',
        created_at: new Date(2026, 9, 27, 10, 0, 0),
        status: TenantLeadStatus.LOST,
      },
    ]);

    const [, recentes] = prisma.callsOf('tenantLead', 'findMany');

    expect(recentes.args.take).toBe(10);
    expect(whereOf(recentes).createdAt).toBeUndefined();
  });

  it('aplica o recorte de período nas captações (mas não na lista recente)', async () => {
    seedCaptacoes();

    await service.getCaptadorDashboard(captadorUser(), { period: 'last_7_days' });

    const [captacoes] = prisma.callsOf('tenantLead', 'findMany');
    const createdAt = whereOf(captacoes).createdAt as { gte: Date; lte: Date };

    expect(createdAt.gte).toBeInstanceOf(Date);
    expect(createdAt.lte).toBeInstanceOf(Date);
    expect(createdAt.lte.getTime()).toBeGreaterThan(createdAt.gte.getTime());
  });
});

describe('DashboardService — isolamento por tenant', () => {
  it('toda consulta dos três dashboards carrega o tenant da sessão', async () => {
    const prisma = new FakePrisma();
    prisma.stages = SEED_STAGES;
    const service = new DashboardService(prisma as unknown as PrismaService);

    prisma.leadPages = [[]];
    await service.getAdminDashboard(adminUser(), {});

    prisma.leadPages = [[], []];
    await service.getSellerDashboard(sellerUser(), {});

    prisma.leadPages = [[], []];
    await service.getCaptadorDashboard(captadorUser(), {});

    expect(prisma.calls.length).toBeGreaterThan(0);

    for (const call of prisma.calls) {
      expect(
        hasTenantFilter(call.args, TENANT),
        `${call.model}.${call.method} sem filtro de tenant`,
      ).toBe(true);
    }
  });
});

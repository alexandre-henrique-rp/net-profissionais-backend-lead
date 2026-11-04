import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types.js';
import { BusinessException } from '../common/errors/business.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantLeadStatus, type Prisma } from '../generated/prisma/client.js';
import type { CommercialTermsDto } from './dto/commercial-terms.dto.js';
import type { MarkAsLostDto } from './dto/mark-as-lost.dto.js';
import type { MoveStageDto } from './dto/move-stage.dto.js';
import type { PipelineOrderBy, PipelineQueryDto } from './dto/pipeline-query.dto.js';
import { lossReasonLabel, normalizeLossReasonCode } from './loss-reasons.js';
import { PipelineEventsService } from './pipeline-events.service.js';

/** Janela de inatividade que acende o alerta do card (48 horas). */
const STAGNANT_ALERT_MS = 48 * 60 * 60 * 1000;

/** O card carrega só o necessário para desenhar a coluna do Kanban. */
const PIPELINE_INCLUDE = {
  lead: {
    select: {
      companyName: true,
      tradeName: true,
      cnpj: true,
      city: true,
      state: true,
    },
  },
  assignedUser: { select: { id: true, name: true } },
} as const;

/** Linha do funil com as relações do card resolvidas. */
type PipelineRow = Prisma.TenantLeadGetPayload<{ include: typeof PIPELINE_INCLUDE }>;

/** Etapa como o Kanban a desenha (cabeçalho da coluna). */
export interface PipelineStageSummary {
  id: string;
  name: string;
  code: string;
  position: number;
  color_hex: string;
  is_lost_stage: boolean;
}

/** Empresa exibida no card. */
export interface PipelineLeadSummary {
  company_name: string | null;
  trade_name: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
}

export interface PipelineAssignedUser {
  id: string;
  name: string;
}

/**
 * Card do funil — visão enxuta usada pelo Kanban e pela Lista.
 *
 * É o **mesmo shape** na leitura (`GET /leads/pipeline`) e nas três rotas de
 * escrita (`PATCH /stage`, `PUT /commercial-terms`, `POST /mark-as-lost`):
 * o frontend atualiza o card com o retorno da mutação, então os dois lados não
 * podem divergir em nome de campo nem em tipo (`ticket_value` é `number`, nunca
 * a string que o `Decimal` do Prisma produz no JSON).
 */
export interface PipelineCard {
  id: string;
  stage_id: string;
  status: string;
  lead: PipelineLeadSummary;
  assigned_user: PipelineAssignedUser | null;
  ticket_value: number | null;
  close_probability: number | null;
  expected_close_date: Date | null;
  proposal_scope: string | null;
  loss_reason_code: string | null;
  loss_reason_notes: string | null;
  last_contact_at: Date | null;
  version: number;
  has_alert: boolean;
}

/** Coluna do funil com os somatórios já calculados. */
export interface PipelineStageColumn {
  stage: PipelineStageSummary;
  cards: PipelineCard[];
  count: number;
  total_value: number;
}

export interface PipelineResult {
  stages: PipelineStageColumn[];
  totals: { count: number; total_value: number };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formata reais no padrão brasileiro (usado nas mensagens da timeline). */
function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/** Soma valores monetários sem herdar o ruído de ponto flutuante. */
function sumMoney(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
}

/**
 * Card em alerta: nunca contatado ou parado há mais de 48 horas.
 *
 * O mesmo predicado filtra (`has_alerts=true`) e marca o card — se ficassem
 * duas implementações, o filtro e o selo poderiam divergir.
 *
 * `// ASM:` aniversariantes da semana (`LeadSpecialDate`) ainda **não** entram
 * neste predicado; a spec §2.5 prevê os dois critérios, mas só a estagnação
 * está implementada. Registrado como decisão consciente desta rodada.
 */
function isStagnant(lastContactAt: Date | null, now: number): boolean {
  if (!lastContactAt) {
    return true;
  }

  return now - lastContactAt.getTime() > STAGNANT_ALERT_MS;
}

/** `Decimal` do Prisma → `number` (a resposta é JSON, não objeto Prisma). */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

/** Serializa a linha do funil no shape do contrato (snake_case, sem `Decimal`). */
function toPipelineCard(row: PipelineRow, now: number): PipelineCard {
  return {
    id: row.id,
    stage_id: row.stageId,
    status: row.status,
    lead: {
      company_name: row.lead.companyName,
      trade_name: row.lead.tradeName,
      cnpj: row.lead.cnpj,
      city: row.lead.city,
      state: row.lead.state,
    },
    assigned_user: row.assignedUser
      ? { id: row.assignedUser.id, name: row.assignedUser.name }
      : null,
    ticket_value: toNumber(row.ticketValue),
    close_probability: row.closeProbability,
    expected_close_date: row.expectedCloseDate,
    proposal_scope: row.proposalScope,
    loss_reason_code: row.lossReasonCode,
    loss_reason_notes: row.lossReasonNotes,
    last_contact_at: row.lastContactAt,
    version: row.version,
    has_alert: isStagnant(row.lastContactAt, now),
  };
}

/**
 * `version` do lock otimista — `expected_version` é o nome usado pela spec.
 *
 * O `whitelist` do `ValidationPipe` descarta campo que não existe no DTO, por
 * isso o alias precisa estar declarado: sem ele o lock otimista ficava
 * silenciosamente desligado quando o cliente seguia a especificação.
 */
function resolveVersion(dto: { version?: number; expected_version?: number }): number {
  const version = dto.version ?? dto.expected_version;

  if (version === undefined) {
    throw new BusinessException(
      400,
      'VALIDATION_ERROR',
      'Informe a versão atual do card (`version` ou `expected_version`).',
    );
  }

  return version;
}

/** Ordenação de cada coluna: o `id`/`createdAt` é o desempate estável. */
function orderByFor(
  orderBy: PipelineOrderBy = 'ticket_desc',
): Prisma.TenantLeadOrderByWithRelationInput[] {
  switch (orderBy) {
    case 'ticket_asc':
      return [{ ticketValue: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'created_at_desc':
      return [{ createdAt: 'desc' }];
    case 'close_date_asc':
      return [
        { expectedCloseDate: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ];
    case 'probability_desc':
      return [
        { closeProbability: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ];
    case 'ticket_desc':
    default:
      return [{ ticketValue: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
  }
}

/**
 * Regras do Funil de Vendas (Kanban `04-A` e Lista `04-B`).
 *
 * Toda leitura e escrita é escopada pelo `tenantId` da sessão — o frontend
 * nunca informa o tenant.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: PipelineEventsService,
  ) {}

  /** `GET /leads/pipeline` — funil agrupado nas etapas, com somatórios. */
  async getPipeline(user: AuthUser, query: PipelineQueryDto): Promise<PipelineResult> {
    const where = this.buildWhere(user, query);
    const stageCode =
      query.stage && query.stage !== 'all' ? query.stage : undefined;

    const [stages, rows] = await Promise.all([
      this.prisma.stage.findMany({
        where: { tenantId: user.tenantId, ...(stageCode ? { code: stageCode } : {}) },
        orderBy: { position: 'asc' },
      }),
      this.prisma.tenantLead.findMany({
        where,
        include: PIPELINE_INCLUDE,
        orderBy: orderByFor(query.order_by),
      }),
    ]);

    const now = Date.now();
    const cardsByStage = new Map<string, PipelineCard[]>();

    for (const row of rows) {
      const card = toPipelineCard(row, now);

      // O alerta é calculado em memória (depende de "agora"), então o filtro
      // também roda aqui — os somatórios são refeitos sobre o que sobrou.
      if (query.has_alerts === true && !card.has_alert) {
        continue;
      }

      const cards = cardsByStage.get(row.stageId) ?? [];

      cards.push(card);

      cardsByStage.set(row.stageId, cards);
    }

    const columns: PipelineStageColumn[] = stages.map((stage) => {
      const cards = cardsByStage.get(stage.id) ?? [];
      const values = cards
        .map((card) => card.ticket_value)
        .filter((value): value is number => value !== null);

      return {
        stage: {
          id: stage.id,
          name: stage.name,
          code: stage.code,
          position: stage.position,
          color_hex: stage.colorHex,
          is_lost_stage: stage.isLostStage,
        },
        cards,
        count: cards.length,
        total_value: sumMoney(values),
      };
    });

    // Os cards do Pool continuam visíveis na coluna em que estão, mas os KPIs
    // do topo do funil são da **carteira comercial**: lead que ninguém assumiu
    // ainda não é oportunidade e não pode inflar `totals`.
    const portfolioCards = columns
      .flatMap((column) => column.cards)
      .filter((card) => card.assigned_user !== null);
    const portfolioValues = portfolioCards
      .map((card) => card.ticket_value)
      .filter((value): value is number => value !== null);

    return {
      stages: columns,
      totals: {
        count: portfolioCards.length,
        total_value: sumMoney(portfolioValues),
      },
    };
  }

  /** `PATCH /leads/:id/stage` — drag-and-drop entre colunas. */
  async moveStage(
    user: AuthUser,
    tenantLeadId: string,
    dto: MoveStageDto,
  ): Promise<PipelineCard> {
    const current = await this.findTenantLead(tenantLeadId, user.tenantId);
    this.assertCanActOnLead(user, current.assignedUserId);

    const target = await this.resolveTargetStage(user.tenantId, dto);
    const lossCode = target.isLostStage
      ? this.requireLossReason(dto.loss_reason_code)
      : null;

    // `// ASM:` fechar como ganho (`6_fechado_ganho`) ainda não exige
    // `ticket_value > 0`; a regra de produto existe em `task-s04-02`, mas fica
    // fora desta correção para não bloquear o drag-and-drop atual.
    const data: Prisma.TenantLeadUncheckedUpdateManyInput = {
      stageId: target.id,
      // Movimentar o card é atividade comercial: zera o relógio do alerta.
      lastContactAt: new Date(),
      version: { increment: 1 },
    };

    if (target.isLostStage) {
      data.status = TenantLeadStatus.LOST;
      data.lossReasonCode = lossCode;
      data.lossReasonNotes = dto.loss_reason_notes ?? null;
    } else if (current.status === TenantLeadStatus.LOST) {
      // Saiu da etapa de perda: o motivo antigo deixa de valer.
      data.lossReasonCode = null;
      data.lossReasonNotes = null;
      // `CLAIMED` sem responsável tirava o lead do Pool (que só lista
      // AVAILABLE/RETURNED_TO_POOL) e o deixava órfão no funil: ninguém o
      // enxergava. Sem dono, ele volta a ser captável.
      data.status = current.assignedUserId
        ? TenantLeadStatus.CLAIMED
        : TenantLeadStatus.AVAILABLE;
    }

    const content =
      target.isLostStage && lossCode
        ? `Motivo da perda: ${lossReasonLabel(lossCode)}${
            dto.loss_reason_notes ? ` — ${dto.loss_reason_notes}` : ''
          }`
        : `Etapa anterior: ${current.stage.name}`;

    const updated = await this.writeWithTimeline({
      user,
      tenantLeadId,
      version: resolveVersion(dto),
      data,
      title: `Etapa alterada para ${target.name}`,
      content,
    });

    this.events.emit({
      tenantId: user.tenantId,
      tenantLeadId,
      stageId: target.id,
      movedBy: user.userId,
    });

    return toPipelineCard(updated, Date.now());
  }

  /** `PUT /leads/:id/commercial-terms` — Modal 1 de Overlays. */
  async updateCommercialTerms(
    user: AuthUser,
    tenantLeadId: string,
    dto: CommercialTermsDto,
  ): Promise<PipelineCard> {
    const current = await this.findTenantLead(tenantLeadId, user.tenantId);
    this.assertCanActOnLead(user, current.assignedUserId);

    // A especificação do modal usa `close_probability_percentage`; o contrato
    // da API usa `close_probability`. Os dois apontam para o mesmo campo.
    const probability = dto.close_probability ?? dto.close_probability_percentage;

    const data: Prisma.TenantLeadUncheckedUpdateManyInput = {
      version: { increment: 1 },
    };

    if (dto.ticket_value !== undefined) {
      data.ticketValue = dto.ticket_value;
    }

    if (probability !== undefined) {
      data.closeProbability = probability;
    }

    if (dto.expected_close_date !== undefined) {
      data.expectedCloseDate = this.parseCloseDate(dto.expected_close_date);
    }

    if (dto.proposal_scope !== undefined) {
      data.proposalScope = dto.proposal_scope;
    }

    const parts: string[] = [];

    if (dto.ticket_value !== undefined) {
      parts.push(`Proposta de ${formatBrl(dto.ticket_value)}`);
    }

    if (probability !== undefined) {
      parts.push(`probabilidade de ${probability}%`);
    }

    if (dto.expected_close_date !== undefined) {
      parts.push(`fechamento previsto para ${dto.expected_close_date}`);
    }

    const updated = await this.writeWithTimeline({
      user,
      tenantLeadId,
      version: resolveVersion(dto),
      data,
      title: 'Termos comerciais atualizados',
      content: parts.length > 0 ? parts.join(' · ') : 'Termos comerciais atualizados.',
      noteType: 'NOTE',
    });

    return toPipelineCard(updated, Date.now());
  }

  /** `POST /leads/:id/mark-as-lost` — Modal 2 de Overlays. */
  async markAsLost(
    user: AuthUser,
    tenantLeadId: string,
    dto: MarkAsLostDto,
  ): Promise<PipelineCard> {
    const current = await this.findTenantLead(tenantLeadId, user.tenantId);
    this.assertCanActOnLead(user, current.assignedUserId);

    const lossCode = this.requireLossReason(dto.loss_reason_code);
    const notes = dto.loss_reason_notes ?? dto.additional_notes ?? null;
    const lostStage = await this.findLostStage(user.tenantId);

    const updated = await this.writeWithTimeline({
      user,
      tenantLeadId,
      version: resolveVersion(dto),
      data: {
        stageId: lostStage.id,
        status: TenantLeadStatus.LOST,
        lossReasonCode: lossCode,
        lossReasonNotes: notes,
        version: { increment: 1 },
      },
      title: `Etapa alterada para ${lostStage.name}`,
      content: `Motivo da perda: ${lossReasonLabel(lossCode)}${
        notes ? ` — ${notes}` : ''
      }`,
    });

    // A perda também move o card de coluna: o Kanban precisa saber.
    this.events.emit({
      tenantId: user.tenantId,
      tenantLeadId,
      stageId: lostStage.id,
      movedBy: user.userId,
    });

    return toPipelineCard(updated, Date.now());
  }

  /**
   * Escrita com lock otimista + nota de timeline na mesma transação.
   *
   * `count === 0` significa que a `version` mudou entre a leitura e a escrita
   * (ou o card saiu do tenant) — nada é gravado, nem a nota.
   */
  private async writeWithTimeline(params: {
    user: AuthUser;
    tenantLeadId: string;
    version: number;
    data: Prisma.TenantLeadUncheckedUpdateManyInput;
    title: string;
    content: string;
    noteType?: 'NOTE' | 'STATUS_CHANGE';
  }): Promise<PipelineRow> {
    const { user, tenantLeadId, version, data, title, content } = params;
    const noteType = params.noteType ?? 'STATUS_CHANGE';

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.tenantLead.updateMany({
        where: { id: tenantLeadId, tenantId: user.tenantId, version },
        data,
      });

      if (count === 0) {
        throw new BusinessException(
          409,
          'VERSION_CONFLICT',
          'O card foi alterado por outra pessoa. Recarregue o funil e tente novamente.',
        );
      }

      await tx.leadTimelineNote.create({
        data: {
          tenantLeadId,
          userId: user.userId,
          type: noteType,
          title,
          content,
        },
      });

      // `tenantId` repetido na leitura: defesa em profundidade contra um
      // refactor que reordene as chamadas.
      return tx.tenantLead.findFirstOrThrow({
        where: { id: tenantLeadId, tenantId: user.tenantId },
        include: PIPELINE_INCLUDE,
      });
    });
  }

  /** WHERE do funil: escopo de tenant + RBAC + filtros da spec §2.5. */
  private buildWhere(
    user: AuthUser,
    query: PipelineQueryDto,
  ): Prisma.TenantLeadWhereInput {
    const conditions: Prisma.TenantLeadWhereInput[] = [
      { tenantId: user.tenantId },
      // Perdidos só existem na coluna de perda; nas demais, ficam de fora.
      {
        OR: [
          { status: { not: TenantLeadStatus.LOST } },
          { stage: { isLostStage: true } },
        ],
      },
    ];

    if (user.operationalRole === 'VENDEDOR') {
      // Vendedor só enxerga a própria carteira, mesmo pedindo `all`.
      conditions.push({ assignedUserId: user.userId });
    } else if (query.assigned_user_id === 'me') {
      conditions.push({ assignedUserId: user.userId });
    } else if (
      query.assigned_user_id &&
      query.assigned_user_id !== 'all'
    ) {
      conditions.push({ assignedUserId: query.assigned_user_id });
    }

    if (query.stage && query.stage !== 'all') {
      conditions.push({ stage: { code: query.stage } });
    }

    if (query.ticket_min !== undefined || query.ticket_max !== undefined) {
      conditions.push({
        ticketValue: {
          ...(query.ticket_min !== undefined ? { gte: query.ticket_min } : {}),
          ...(query.ticket_max !== undefined ? { lte: query.ticket_max } : {}),
        },
      });
    }

    const term = query.q?.trim();

    if (term) {
      const digits = term.replace(/\D/g, '');
      const leadConditions: Prisma.LeadWhereInput[] = [
        { companyName: { contains: term, mode: 'insensitive' } },
        { tradeName: { contains: term, mode: 'insensitive' } },
      ];

      if (digits.length >= 3) {
        leadConditions.push({ cnpj: { contains: digits } });
      }

      conditions.push({ lead: { OR: leadConditions } });
    }

    return { AND: conditions };
  }

  /** Card do tenant — 404 `LEAD_NOT_FOUND` quando não existe (ou é de outro). */
  private async findTenantLead(tenantLeadId: string, tenantId: string) {
    // Id fora do formato UUID estouraria no Postgres: responde como 404.
    if (!UUID_PATTERN.test(tenantLeadId)) {
      throw new BusinessException(
        404,
        'LEAD_NOT_FOUND',
        'Oportunidade não encontrada no funil desta corporação.',
      );
    }

    const tenantLead = await this.prisma.tenantLead.findFirst({
      where: { id: tenantLeadId, tenantId },
      include: { stage: true },
    });

    if (!tenantLead) {
      throw new BusinessException(
        404,
        'LEAD_NOT_FOUND',
        'Oportunidade não encontrada no funil desta corporação.',
      );
    }

    return tenantLead;
  }

  /** Vendedor só mexe no que é dele; Admin e Captador mexem no tenant. */
  private assertCanActOnLead(user: AuthUser, assignedUserId: string | null): void {
    if (user.operationalRole === 'VENDEDOR' && assignedUserId !== user.userId) {
      throw new BusinessException(
        403,
        'FORBIDDEN',
        'Você só pode alterar oportunidades atribuídas a você.',
      );
    }
  }

  /** Etapa de destino por UUID ou por código, sempre dentro do tenant. */
  private async resolveTargetStage(tenantId: string, dto: MoveStageDto) {
    const code = dto.stage ?? dto.new_stage;

    if (!dto.stage_id && !code) {
      throw new BusinessException(
        422,
        'INVALID_STAGE_TRANSITION',
        'Informe a etapa de destino (`stage_id` ou `stage`).',
      );
    }

    const stage = await this.prisma.stage.findFirst({
      where: {
        tenantId,
        ...(dto.stage_id ? { id: dto.stage_id } : { code }),
      },
    });

    if (!stage) {
      throw new BusinessException(
        422,
        'INVALID_STAGE_TRANSITION',
        'A etapa de destino não existe no funil desta corporação.',
      );
    }

    return stage;
  }

  /** Etapa de perda do tenant — a de maior `position` quando há mais de uma. */
  private async findLostStage(tenantId: string) {
    const stage = await this.prisma.stage.findFirst({
      where: { tenantId, isLostStage: true },
      orderBy: { position: 'desc' },
    });

    if (!stage) {
      throw new BusinessException(
        422,
        'INVALID_STAGE_TRANSITION',
        'A corporação não possui etapa de perda configurada.',
      );
    }

    return stage;
  }

  /** Código de perda válido ou 422 `LOSS_REASON_REQUIRED`. */
  private requireLossReason(code: string | undefined): string {
    const normalized = normalizeLossReasonCode(code);

    if (!normalized) {
      throw new BusinessException(
        422,
        'LOSS_REASON_REQUIRED',
        'Selecione uma das 6 causas parametrizadas de motivo da perda.',
      );
    }

    return normalized;
  }

  /**
   * Data de fechamento prevista: aceita ISO 8601 e `AAAA-MM-DD` e recusa
   * datas passadas (o modal só permite hoje em diante).
   *
   * A comparação é feita no **dia** do calendário, não no instante: em UTC,
   * `2026-10-28T00:00:00.000Z` é 27/10 às 21h de São Paulo, e comparar
   * timestamps recusava "hoje" como data passada. O dia local do servidor é a
   * régua do modal — é o mesmo fuso que o vendedor vê na tela.
   */
  private parseCloseDate(value: string): Date {
    const isDateOnly = value.length === 10;
    const parsed = new Date(isDateOnly ? `${value}T00:00:00.000Z` : value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BusinessException(
        400,
        'VALIDATION_ERROR',
        'A data prevista de fechamento deve estar no formato ISO 8601.',
      );
    }

    const now = new Date();
    const todayKey = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    // `AAAA-MM-DD` foi parseado como UTC; ISO completo precisa do dia local.
    const targetKey = isDateOnly
      ? Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
      : Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

    if (targetKey < todayKey) {
      throw new BusinessException(
        400,
        'VALIDATION_ERROR',
        'A data prevista de fechamento não pode estar no passado.',
      );
    }

    return parsed;
  }
}

import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  LeadSpecialDateType,
  TenantLeadStatus,
  type Prisma,
} from '../generated/prisma/client.js';
import { LOSS_REASONS, normalizeLossReasonCode } from '../pipeline/loss-reasons.js';
import {
  daysUntilDayMonth,
  isWithinBirthdayWindow,
} from './birthdays.js';
import { buildChannelFilter } from './channel.js';
import type {
  AdminDashboardResponse,
  BirthdayEntry,
  CaptadorDashboardResponse,
  FunnelEntry,
  LossReasonEntry,
  RecentCaptureEntry,
  SellerDashboardResponse,
  SellerPerformanceEntry,
  StatusCountEntry,
  TodayTaskEntry,
} from './dashboard.types.js';
import {
  averageMoney,
  CONVERSION_RATE_BASIS,
  conversionRate,
  isStagnant,
  percentage,
  STAGNANT_ALERT_MS,
  sumMoney,
  toNumber,
} from './metrics.js';
import { periodDateFilter, resolvePeriod } from './period.js';
import { wonStageIds } from './stages.js';
import { buildTaskReason } from './tasks.js';
import type { DashboardQueryDto } from './dto/dashboard-query.dto.js';

/**
 * Abaixo do tipo gerado pelo Prisma, o mínimo que cada dashboard consome.
 *
 * Declarar os formatos aqui (em vez de repetir `Prisma.…GetPayload`) deixa a
 * agregação legível e evita que o service dependa de um `include` gigante.
 */
interface DashboardLeadRow {
  id: string;
  stageId: string;
  status: string;
  ticketValue: unknown;
  lastContactAt: Date | null;
}

interface AdminLeadRow extends DashboardLeadRow {
  assignedUserId: string | null;
  lossReasonCode: string | null;
  assignedUser: { id: string; name: string } | null;
}

interface SellerLeadRow extends DashboardLeadRow {
  expectedCloseDate: Date | null;
  lead: { companyName: string | null; tradeName: string | null };
  stage: { name: string };
}

interface CaptadorLeadRow extends DashboardLeadRow {
  lead: { companyName: string | null; tradeName: string | null };
}

/** Status na ordem em que a esteira do captador os apresenta. */
const CAPTADOR_STATUS_ORDER: TenantLeadStatus[] = [
  TenantLeadStatus.AVAILABLE,
  TenantLeadStatus.CLAIMED,
  TenantLeadStatus.RETURNED_TO_POOL,
  TenantLeadStatus.LOST,
];

/**
 * Teto da agenda do dia — o widget é um resumo, não uma listagem paginada.
 *
 * A contagem do KPI **não** usa este teto: `today_tasks_total` vem de um
 * `count` com o mesmo `where`, senão o vendedor com 45 pendências leria "20".
 */
const TODAY_TASKS_LIMIT = 20;

/** Quantidade de captações recentes exibidas na tabela do captador. */
const RECENT_CAPTURES_LIMIT = 10;

const ADMIN_ROW_SELECT = {
  id: true,
  stageId: true,
  assignedUserId: true,
  status: true,
  ticketValue: true,
  lossReasonCode: true,
  lastContactAt: true,
  assignedUser: { select: { id: true, name: true } },
} satisfies Prisma.TenantLeadSelect;

const SELLER_ROW_SELECT = {
  id: true,
  stageId: true,
  status: true,
  ticketValue: true,
  lastContactAt: true,
  expectedCloseDate: true,
  lead: { select: { companyName: true, tradeName: true } },
  stage: { select: { name: true } },
} satisfies Prisma.TenantLeadSelect;

const CAPTADOR_ROW_SELECT = {
  id: true,
  stageId: true,
  status: true,
  ticketValue: true,
  lastContactAt: true,
  lead: { select: { companyName: true, tradeName: true } },
} satisfies Prisma.TenantLeadSelect;

/** Consolida os contadores de etapa a partir das etapas do tenant. */
function buildFunnel(
  stages: readonly { id: string; name: string; code: string; position: number; colorHex: string }[],
  rows: readonly DashboardLeadRow[],
): FunnelEntry[] {
  return stages.map((stage) => {
    const stageRows = rows.filter((row) => row.stageId === stage.id);

    return {
      stage_id: stage.id,
      stage_name: stage.name,
      code: stage.code,
      position: stage.position,
      color_hex: stage.colorHex,
      count: stageRows.length,
      total_value: sumMoney(stageRows.map((row) => toNumber(row.ticketValue))),
    };
  });
}

/**
 * Dashboard do Administrador (`Tela 02-A-D`).
 *
 * Recorte único: todas as métricas consideram a coorte de oportunidades
 * **criadas** dentro do período (`TenantLead.createdAt`), para que os KPIs
 * somem entre si (o funil, os vendedores e os motivos de perda falam do mesmo
 * conjunto de leads). O `tenantId` sai sempre da sessão — `AuthUser.tenantId`,
 * o mesmo valor injetado por `@CurrentTenant()` — e nunca da query.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /dashboard/admin` — consolidado corporativo. */
  async getAdminDashboard(
    user: AuthUser,
    query: DashboardQueryDto,
  ): Promise<AdminDashboardResponse> {
    const period = resolvePeriod(query.period, query.start_date, query.end_date);
    const now = Date.now();

    const [stages, rows] = await Promise.all([
      this.prisma.stage.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.tenantLead.findMany({
        where: {
          tenantId: user.tenantId,
          ...periodDateFilter(period),
          ...buildChannelFilter(query.channel),
        },
        select: ADMIN_ROW_SELECT,
      }),
    ]);

    const adminRows: AdminLeadRow[] = rows;
    const wonStages = wonStageIds(stages);
    const isWon = (row: DashboardLeadRow): boolean => wonStages.has(row.stageId);

    const lostRows = adminRows.filter((row) => row.status === TenantLeadStatus.LOST);
    const wonRows = adminRows.filter(isWon);
    /**
     * Pipeline = lead **em negociação**: atribuído a um vendedor, em aberto e
     * fora das etapas de ganho. Antes a conta era `status !== LOST`, o que
     * somava o Pool (ninguém trabalha nele) e contava o negócio ganho duas
     * vezes (aqui e em `won_total_value`).
     */
    const pipelineRows = adminRows.filter(
      (row) =>
        row.status === TenantLeadStatus.CLAIMED &&
        row.assignedUserId !== null &&
        !isWon(row),
    );

    const lossCounts = new Map<string, number>();

    for (const row of lostRows) {
      // Código desconhecido/ausente cai em `outro`: o breakdown sempre fecha
      // com o total de perdidos.
      const code = normalizeLossReasonCode(row.lossReasonCode) ?? 'outro';
      lossCounts.set(code, (lossCounts.get(code) ?? 0) + 1);
    }

    const lossReasons: LossReasonEntry[] = LOSS_REASONS.map((reason) => {
      const count = lossCounts.get(reason.code) ?? 0;

      return {
        code: reason.code,
        label: reason.label,
        count,
        percentage: percentage(count, lostRows.length),
      };
    });

    const sellersById = new Map<string, SellerPerformanceEntry>();

    for (const row of adminRows) {
      if (!row.assignedUserId || !row.assignedUser) {
        continue;
      }

      const entry: SellerPerformanceEntry = sellersById.get(row.assignedUserId) ?? {
        user_id: row.assignedUserId,
        name: row.assignedUser.name,
        claimed_count: 0,
        won_count: 0,
        total_value: 0,
      };

      entry.claimed_count += 1;

      if (isWon(row)) {
        entry.won_count += 1;
      }

      if (row.status !== TenantLeadStatus.LOST) {
        entry.total_value = sumMoney([entry.total_value, toNumber(row.ticketValue)]);
      }

      sellersById.set(row.assignedUserId, entry);
    }

    const sellers = [...sellersById.values()].sort(
      (left, right) =>
        right.total_value - left.total_value || left.name.localeCompare(right.name),
    );

    return {
      kpis: {
        total_leads: adminRows.length,
        leads_in_pool: adminRows.filter(
          (row) =>
            row.status === TenantLeadStatus.AVAILABLE ||
            row.status === TenantLeadStatus.RETURNED_TO_POOL,
        ).length,
        leads_claimed: adminRows.filter((row) => row.status === TenantLeadStatus.CLAIMED)
          .length,
        leads_won: wonRows.length,
        leads_lost: lostRows.length,
        // Percentual sobre a coorte do período (spec `task-s06-01` §2), não
        // fração sobre ganhos+perdidos: 1 venda em 4 oportunidades = 25.
        conversion_rate: conversionRate(wonRows.length, adminRows.length),
        conversion_rate_basis: CONVERSION_RATE_BASIS,
        pipeline_total_value: sumMoney(pipelineRows.map((row) => toNumber(row.ticketValue))),
        won_total_value: sumMoney(wonRows.map((row) => toNumber(row.ticketValue))),
        average_ticket: averageMoney(adminRows.map((row) => toNumber(row.ticketValue))),
        // Alerta só para o que alguém pode resolver: lead em carteira, em
        // aberto e ainda não ganho (perdido e Pool não entram na agenda).
        inactivity_alerts: adminRows.filter(
          (row) =>
            row.status === TenantLeadStatus.CLAIMED &&
            row.assignedUserId !== null &&
            !isWon(row) &&
            isStagnant(row.lastContactAt, now),
        ).length,
      },
      funnel: buildFunnel(stages, adminRows),
      loss_reasons: lossReasons,
      sellers,
      period,
    };
  }

  /**
   * `GET /dashboard/seller` — rotina da carteira pessoal.
   *
   * // ASM: a tela `02-B-D` tem card de meta mensal (`monthly_goal` /
   * // `goal_percentage`), mas o schema do MVP 1 não guarda meta por tenant nem
   * // por vendedor — os dois campos ficam de fora até a decisão de produto.
   */
  async getSellerDashboard(
    user: AuthUser,
    query: DashboardQueryDto,
  ): Promise<SellerDashboardResponse> {
    const period = resolvePeriod(query.period, query.start_date, query.end_date);
    const now = new Date();
    const inactiveBefore = new Date(now.getTime() - STAGNANT_ALERT_MS);
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    /**
     * `where` da agenda do dia — reaproveitado pela listagem (`take`) e pela
     * contagem (`count`), para que os dois nunca divirjam.
     */
    const taskWhere: Prisma.TenantLeadWhereInput = {
      tenantId: user.tenantId,
      assignedUserId: user.userId,
      status: { not: TenantLeadStatus.LOST },
      OR: [
        { lastContactAt: null },
        { lastContactAt: { lt: inactiveBefore } },
        { expectedCloseDate: { lte: endOfToday } },
      ],
    };

    const [stages, rows, taskRows, taskTotal, specialDates] = await this.prisma.$transaction([
      this.prisma.stage.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.tenantLead.findMany({
        where: {
          tenantId: user.tenantId,
          // Escopo do vendedor: a própria carteira, sempre — qualquer
          // `assigned_user_id` vindo do cliente é ignorado.
          assignedUserId: user.userId,
          ...periodDateFilter(period),
          ...buildChannelFilter(query.channel),
        },
        select: SELLER_ROW_SELECT,
      }),
      // Lista: só as primeiras 20 (o widget é um resumo).
      this.prisma.tenantLead.findMany({
        where: taskWhere,
        select: SELLER_ROW_SELECT,
        orderBy: [
          { expectedCloseDate: { sort: 'asc', nulls: 'last' } },
          { lastContactAt: { sort: 'asc', nulls: 'first' } },
        ],
        take: TODAY_TASKS_LIMIT,
      }),
      // Contagem: o total real de pendências, sem o teto da listagem.
      this.prisma.tenantLead.count({ where: taskWhere }),
      // ASM: a agenda e os aniversários são listas de "agora" — não entram no
      // recorte de `period` (o card responde "o que eu tenho hoje",
      // independente do filtro da tela). Por isso este `findMany` não leva
      // `periodDateFilter`.
      this.prisma.leadSpecialDate.findMany({
        where: {
          lead: { tenantLeads: { some: { tenantId: user.tenantId, assignedUserId: user.userId } } },
        },
        select: {
          leadId: true,
          dateType: true,
          dayMonth: true,
          lead: {
            select: {
              companyName: true,
              tradeName: true,
              contacts: {
                select: { name: true },
                orderBy: [{ isPrimary: 'desc' }, { isDecisionMaker: 'desc' }],
                take: 1,
              },
            },
          },
        },
      }),
    ]);

    const sellerRows: SellerLeadRow[] = rows;
    const wonStages = wonStageIds(stages);
    const lostRows = sellerRows.filter((row) => row.status === TenantLeadStatus.LOST);
    const wonRows = sellerRows.filter((row) => wonStages.has(row.stageId));
    // Pipeline próprio: em negociação, fora das etapas de ganho (senão o valor
    // apareceria também em `my_won_value`).
    const pipelineRows = sellerRows.filter(
      (row) =>
        row.status === TenantLeadStatus.CLAIMED && !wonStages.has(row.stageId),
    );

    const todayTasks: TodayTaskEntry[] = taskRows.map((row) => ({
      tenant_lead_id: row.id,
      company_name: row.lead.companyName ?? row.lead.tradeName,
      stage_name: row.stage?.name ?? null,
      reason: buildTaskReason(
        { lastContactAt: row.lastContactAt, expectedCloseDate: row.expectedCloseDate },
        now,
      ),
    }));

    const birthdays: BirthdayEntry[] = specialDates
      .map((entry) => ({ entry, daysUntil: daysUntilDayMonth(entry.dayMonth, now) }))
      .filter(({ daysUntil }) => isWithinBirthdayWindow(daysUntil))
      .map(({ entry, daysUntil }) => ({
        lead_id: entry.leadId,
        company_name: entry.lead.companyName ?? entry.lead.tradeName,
        // Só o aniversário do sócio tem pessoa associada; o da empresa não.
        contact_name:
          entry.dateType === LeadSpecialDateType.ANIVERSARIO_SOCIO
            ? (entry.lead.contacts[0]?.name ?? null)
            : null,
        date_type: entry.dateType,
        day_month: entry.dayMonth,
        days_until: daysUntil,
        is_today: daysUntil === 0,
      }))
      .sort(
        (left, right) =>
          left.days_until - right.days_until ||
          (left.company_name ?? '').localeCompare(right.company_name ?? ''),
      );

    return {
      kpis: {
        my_leads: sellerRows.length,
        my_won: wonRows.length,
        my_lost: lostRows.length,
        // Percentual sobre a própria coorte (mesma base do admin).
        my_conversion_rate: conversionRate(wonRows.length, sellerRows.length),
        my_conversion_rate_basis: CONVERSION_RATE_BASIS,
        my_pipeline_value: sumMoney(pipelineRows.map((row) => toNumber(row.ticketValue))),
        my_won_value: sumMoney(wonRows.map((row) => toNumber(row.ticketValue))),
        // `today_tasks` continua sendo o tamanho da lista devolvida (compat);
        // `today_tasks_total` é a quantidade real de pendências.
        today_tasks: todayTasks.length,
        today_tasks_total: taskTotal,
      },
      my_funnel: buildFunnel(stages, sellerRows),
      today_tasks: todayTasks,
      birthdays,
    };
  }

  /**
   * `GET /dashboard/captador` — desempenho da prospecção.
   *
   * CAPTADOR enxerga apenas o que ele mesmo cadastrou (`creatorUserId`);
   * ADMIN vê a corporação inteira, porque não capta e precisa do consolidado.
   */
  async getCaptadorDashboard(
    user: AuthUser,
    query: DashboardQueryDto,
  ): Promise<CaptadorDashboardResponse> {
    const period = resolvePeriod(query.period, query.start_date, query.end_date);
    const scope: Prisma.TenantLeadWhereInput =
      user.operationalRole === 'CAPTADOR' ? { creatorUserId: user.userId } : {};

    const [stages, rows, recentRows] = await Promise.all([
      this.prisma.stage.findMany({
        where: { tenantId: user.tenantId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.tenantLead.findMany({
        where: {
          tenantId: user.tenantId,
          ...scope,
          ...periodDateFilter(period),
          ...buildChannelFilter(query.channel),
        },
        select: CAPTADOR_ROW_SELECT,
      }),
      // ASM: "captações recentes" é uma lista de "agora" (as últimas 10), não
      // um recorte do período — o filtro da tela não a restringe.
      this.prisma.tenantLead.findMany({
        where: { tenantId: user.tenantId, ...scope },
        select: {
          id: true,
          status: true,
          createdAt: true,
          lead: { select: { companyName: true, tradeName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_CAPTURES_LIMIT,
      }),
    ]);

    const captadorRows: CaptadorLeadRow[] = rows;
    const wonStages = wonStageIds(stages);
    const wonRows = captadorRows.filter((row) => wonStages.has(row.stageId));

    const byStatus: StatusCountEntry[] = CAPTADOR_STATUS_ORDER.map((status) => ({
      status,
      count: captadorRows.filter((row) => row.status === status).length,
    }));

    const recent: RecentCaptureEntry[] = recentRows.map((row) => ({
      tenant_lead_id: row.id,
      company_name: row.lead.companyName ?? row.lead.tradeName,
      created_at: row.createdAt,
      status: row.status,
    }));

    return {
      kpis: {
        captured_total: captadorRows.length,
        captured_in_pool: captadorRows.filter(
          (row) =>
            row.status === TenantLeadStatus.AVAILABLE ||
            row.status === TenantLeadStatus.RETURNED_TO_POOL,
        ).length,
        captured_claimed: captadorRows.filter(
          (row) => row.status === TenantLeadStatus.CLAIMED,
        ).length,
        captured_won: wonRows.length,
        // Aqui o denominador é o total captado: a pergunta é "quantos dos
        // leads que eu trouxe viraram venda?" — em percentual (0…100), a
        // mesma unidade do card de conversão do admin.
        conversion_rate: conversionRate(wonRows.length, captadorRows.length),
        conversion_rate_basis: CONVERSION_RATE_BASIS,
        // Valor em negociação gerado pela captação (perdidos ficam de fora).
        captured_total_value: sumMoney(
          captadorRows
            .filter((row) => row.status !== TenantLeadStatus.LOST)
            .map((row) => toNumber(row.ticketValue)),
        ),
      },
      by_status: byStatus,
      recent,
    };
  }
}

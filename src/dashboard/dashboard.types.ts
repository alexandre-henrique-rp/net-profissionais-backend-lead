import type { ResolvedPeriod } from './period.js';

/**
 * Contratos de resposta dos três dashboards (`02-A-D`, `02-B-D`, `02-C-D`).
 *
 * Nomes em `snake_case` porque o payload é consumido direto pelos
 * componentes do frontend, que já falam esse dialeto (mesma convenção do
 * funil e do Pool).
 */

/** KPI único de uma etapa do funil (coluna do gráfico). */
export interface FunnelEntry {
  stage_id: string;
  stage_name: string;
  code: string;
  position: number;
  color_hex: string;
  count: number;
  total_value: number;
}

/** Motivo de perda com participação no total de perdidos. */
export interface LossReasonEntry {
  code: string;
  label: string;
  count: number;
  /** Percentual (`0` … `100`) sobre o total de perdidos do período. */
  percentage: number;
}

/** Produtividade por vendedor. */
export interface SellerPerformanceEntry {
  user_id: string;
  name: string;
  claimed_count: number;
  won_count: number;
  total_value: number;
}

/** Payload de `GET /dashboard/admin`. */
export interface AdminDashboardResponse {
  kpis: {
    total_leads: number;
    leads_in_pool: number;
    leads_claimed: number;
    leads_won: number;
    leads_lost: number;
    /** Percentual (`0` … `100`) de ganhos sobre o total da coorte do período. */
    conversion_rate: number;
    /** Semântica de `conversion_rate` — o frontend não precisa adivinhar. */
    conversion_rate_basis: 'won_over_total';
    /** Só leads em aberto **e** atribuídos (Pool e ganhos ficam de fora). */
    pipeline_total_value: number;
    won_total_value: number;
    average_ticket: number;
    inactivity_alerts: number;
  };
  funnel: FunnelEntry[];
  loss_reasons: LossReasonEntry[];
  sellers: SellerPerformanceEntry[];
  period: ResolvedPeriod;
}

/** Tarefa da agenda do dia. */
export interface TodayTaskEntry {
  tenant_lead_id: string;
  company_name: string | null;
  stage_name: string | null;
  reason: string;
}

/** Data especial dentro da janela de 7 dias. */
export interface BirthdayEntry {
  lead_id: string;
  company_name: string | null;
  contact_name: string | null;
  date_type: string;
  /** `'DD/MM'`, como está gravado em `LeadSpecialDate`. */
  day_month: string;
  days_until: number;
  is_today: boolean;
}

/**
 * Payload de `GET /dashboard/seller`.
 *
 * // ASM: a tela `02-B-D` do Penpot mostra um card de meta mensal
 * // (`monthly_goal` / `goal_percentage` / `my_month_revenue`), mas o schema do
 * // MVP 1 não tem coluna de meta por tenant nem por vendedor. Fica pendente de
 * // decisão de produto (tabela `TenantGoal` ou campo em `Tenant`); enquanto
 * // isso o payload entrega apenas os números que existem no banco.
 */
export interface SellerDashboardResponse {
  kpis: {
    my_leads: number;
    my_won: number;
    my_lost: number;
    /** Percentual (`0` … `100`) de ganhos sobre o total da própria coorte. */
    my_conversion_rate: number;
    /** Semântica de `my_conversion_rate`. */
    my_conversion_rate_basis: 'won_over_total';
    /** Só leads em aberto **e** atribuídos (ganhos ficam de fora). */
    my_pipeline_value: number;
    my_won_value: number;
    /** Quantidade de itens **na lista** `today_tasks` (teto de 20). */
    today_tasks: number;
    /** Total real de pendências do dia — a lista é só a primeira página. */
    today_tasks_total: number;
  };
  my_funnel: FunnelEntry[];
  /**
   * Lista de "agora" (não é recorte do período) — o `period` da query não
   * filtra agenda nem aniversários, por desenho: o card responde "o que eu
   * tenho para hoje", independente do filtro da tela.
   */
  today_tasks: TodayTaskEntry[];
  birthdays: BirthdayEntry[];
}

/** Contagem por status da esteira do captador. */
export interface StatusCountEntry {
  status: string;
  count: number;
}

/** Captação recente exibida na tabela do captador. */
export interface RecentCaptureEntry {
  tenant_lead_id: string;
  company_name: string | null;
  created_at: Date;
  status: string;
}

/** Payload de `GET /dashboard/captador`. */
export interface CaptadorDashboardResponse {
  kpis: {
    captured_total: number;
    captured_in_pool: number;
    captured_claimed: number;
    captured_won: number;
    /** Percentual (`0` … `100`) de ganhos sobre o total captado no período. */
    conversion_rate: number;
    /** Semântica de `conversion_rate`. */
    conversion_rate_basis: 'won_over_total';
    captured_total_value: number;
  };
  by_status: StatusCountEntry[];
  /**
   * Lista de "agora" (as 10 captações mais recentes), não recorte do período.
   */
  recent: RecentCaptureEntry[];
}

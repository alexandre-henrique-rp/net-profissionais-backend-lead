/**
 * Catálogo fechado dos motivos de perda (Modal 2 de Overlays, `04-C-D`/`04-C-L`).
 *
 * A lista é parametrizada no código — e não numa tabela — porque o produto
 * define exatamente 6 causas comerciais e o Dashboard do Administrador agrupa
 * o breakdown de perdas por elas. Mudar o catálogo é mudar este arquivo.
 */

/** Motivo de perda aceito pelo backend. */
export interface LossReason {
  /** Código canônico, persistido em `TenantLead.lossReasonCode`. */
  code: string;
  /** Rótulo legível exibido no modal e na timeline. */
  label: string;
}

/** As 6 causas comerciais oficiais (código curto, usado em todo o produto). */
export const LOSS_REASONS: readonly LossReason[] = [
  { code: 'preco', label: 'Preço Alto / Fora do Orçamento do Cliente' },
  { code: 'concorrencia', label: 'Fechou com Concorrente' },
  { code: 'sem_orcamento', label: 'Sem Verba / Projeto Cancelado' },
  { code: 'timing', label: 'Timing Inadequado / Momento do Cliente' },
  { code: 'sem_interesse', label: 'Desistência da Contratação' },
  { code: 'outro', label: 'Outro Motivo Comercial' },
];

/**
 * Sinônimos aceitos na entrada → código canônico.
 *
 * A especificação de produto (`05-especificacao-backend-endpoints-e-respostas.md`
 * §3.3) descreve os mesmos 6 motivos com nomes longos. Aceitá-los evita que o
 * frontend precise traduzir o valor antes de enviar; o que fica gravado é
 * sempre o código canônico, para o breakdown do dashboard não se fragmentar.
 */
const LOSS_REASON_ALIASES: Readonly<Record<string, string>> = {
  preco_alto_fora_orcamento: 'preco',
  fechou_concorrente: 'concorrencia',
  sem_verba_cancelado: 'sem_orcamento',
  cliente_sumiu_sem_retorno: 'sem_interesse',
  desistencia_contratacao: 'sem_interesse',
  outro_motivo_comercial: 'outro',
};

/** Códigos canônicos, na ordem do catálogo. */
export const LOSS_REASON_CODES: readonly string[] = LOSS_REASONS.map(
  (reason) => reason.code,
);

const LOSS_REASONS_BY_CODE = new Map(
  LOSS_REASONS.map((reason) => [reason.code, reason]),
);

/**
 * Normaliza o código recebido para o canônico.
 *
 * Devolve `null` quando o código não pertence ao catálogo — quem chama decide
 * o erro (`LOSS_REASON_REQUIRED` em ambas as rotas, conforme o contrato).
 */
export function normalizeLossReasonCode(
  code: string | undefined | null,
): string | null {
  if (!code) {
    return null;
  }

  const normalized = code.trim().toLowerCase();

  if (LOSS_REASONS_BY_CODE.has(normalized)) {
    return normalized;
  }

  return LOSS_REASON_ALIASES[normalized] ?? null;
}

/** Rótulo legível do motivo (ou o próprio código, se for desconhecido). */
export function lossReasonLabel(code: string): string {
  return LOSS_REASONS_BY_CODE.get(code)?.label ?? code;
}

/**
 * Contrato da exportação de leads (`GET /leads/export`, §2.6).
 */

/** Formatos aceitos pelo botão "⬇ Exportar PDF/CSV". */
export const EXPORT_FORMATS = ['csv', 'pdf'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const DEFAULT_EXPORT_FORMAT: ExportFormat = 'csv';

/**
 * Teto de segurança da exportação.
 *
 * Acima disso o arquivo vira um risco de memória e de tempo de resposta: o
 * service exporta as primeiras 5000 linhas (mais recentes primeiro) e a tela
 * deve refinar o filtro.
 */
export const EXPORT_ROW_LIMIT = 5000;

/**
 * Uma linha do relatório, já achatada.
 *
 * `ticket_value` é `number` (o `Decimal` do Prisma não sobrevive à formatação
 * em CSV/PDF) e `document` carrega CNPJ **ou** CPF, conforme o tipo de pessoa.
 */
export interface ExportLeadRow {
  company_name: string | null;
  trade_name: string | null;
  document: string | null;
  state: string | null;
  city: string | null;
  sector: string | null;
  company_size: string | null;
  temperature: string | null;
  stage_name: string | null;
  assigned_user_name: string | null;
  ticket_value: number | null;
  close_probability: number | null;
  expected_close_date: Date | null;
  last_contact_at: Date | null;
}

/** Arquivo pronto para o `StreamableFile` do controller. */
export interface ExportFile {
  buffer: Buffer;
  filename: string;
  content_type: string;
}

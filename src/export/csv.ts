import { formatDay } from '../dashboard/period.js';
import type { ExportLeadRow } from './export.types.js';

/**
 * Geração do CSV de leads (spec §2.6 / `TASK-S06-03`).
 *
 * Decisões que fazem o arquivo abrir no Excel brasileiro sem ajuste:
 * - **BOM UTF-8** (`\uFEFF`) no começo: sem ele o Excel lê `ç`/`ã` como lixo;
 * - **ponto e vírgula** como separador: é o `list separator` do Windows em
 *   pt-BR, então o arquivo cai em colunas automaticamente;
 * - **CRLF** entre linhas, como manda o RFC 4180;
 * - números com **vírgula decimal** e sem separador de milhar.
 */

/** Separador de colunas do CSV brasileiro. */
export const CSV_SEPARATOR = ';';

/** Quebra de linha do RFC 4180. */
export const CSV_LINE_BREAK = '\r\n';

/** Marca de ordem de bytes (BOM) do UTF-8. */
export const UTF8_BOM = '\uFEFF';

/** Cabeçalho em português, na ordem das colunas da listagem. */
export const CSV_HEADER = [
  'Razão Social',
  'Nome Fantasia',
  'CNPJ/CPF',
  'UF',
  'Cidade',
  'Setor',
  'Porte',
  'Temperatura',
  'Etapa',
  'Responsável',
  'Ticket',
  'Probabilidade',
  'Previsão de Fechamento',
  'Último Contato',
] as const;

/**
 * `Decimal` → texto pt-BR com 2 casas e vírgula decimal.
 *
 * `1234.5` vira `1234,50` (sem `R$` e sem milhar, para a planilha tratar o
 * campo como número quando o usuário trocar o separador).
 */
export function formatTicket(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '';
  }

  return value.toFixed(2).replace('.', ',');
}

/** Data no formato `dd/MM/yyyy`; vazio quando não há data. */
export function formatDate(value: Date | null): string {
  return value ? formatDay(value) : '';
}

/**
 * Caracteres que uma planilha interpreta como **início de fórmula**.
 *
 * `=`, `+`, `-` e `@` são os clássicos; TAB e CR entram porque alguns leitores
 * os descartam antes de avaliar a célula (e o conteúdo seguinte vira fórmula).
 */
const FORMULA_TRIGGER = /^[=+\-@]/;

/** Prefixo que força a planilha a tratar a célula como texto. */
const TEXT_PREFIX = "'";

/**
 * Neutraliza injeção de fórmula em planilha (CSV injection / OWASP).
 *
 * O caminho real é o webhook público: `company_name` vem do parceiro, entra no
 * CSV exportado pelo administrador e é aberto no Excel — onde
 * `=HYPERLINK("http://evil","clique")`, `+1+1`, `-2+3` e `@SUM(1+1)` seriam
 * **avaliados**. O escape de aspas não protege disso: o perigo está no primeiro
 * caractere da célula, não no separador.
 *
 * A defesa é o apóstrofo no começo do valor — o marcador de "texto literal" que
 * Excel e LibreOffice reconhecem. Espaços/quebras iniciais não escondem o
 * gatilho: a checagem olha o primeiro caractere significativo.
 */
export function neutralizeCsvFormula(value: string): string {
  if (value.startsWith('\t') || value.startsWith('\r')) {
    return `${TEXT_PREFIX}${value}`;
  }

  const firstMeaningful = value.replace(/^\s+/, '').charAt(0);

  return FORMULA_TRIGGER.test(firstMeaningful)
    ? `${TEXT_PREFIX}${value}`
    : value;
}

/**
 * Escapa um campo: aspas quando há separador, aspas ou quebra de linha.
 *
 * Sem isso, uma razão social com `;` (ex.: "Silva; Filhos") empurraria todas as
 * colunas seguintes uma casa para a direita.
 */
export function escapeCsvField(value: string): string {
  return quoteCsvField(neutralizeCsvFormula(value));
}

/**
 * Só cita o campo (sem neutralizar fórmula).
 *
 * Reservado aos valores que o próprio módulo gera — número formatado e data
 * `dd/MM/yyyy`. Um ticket negativo não deve virar texto na planilha, e não há
 * como injetar fórmula num valor montado a partir de `number`/`Date`.
 */
function quoteCsvField(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function rowToLine(row: ExportLeadRow): string {
  // Campos textuais: vêm do banco (cadastro manual ou webhook), então passam
  // pela neutralização de fórmula.
  const textFields = [
    row.company_name ?? '',
    row.trade_name ?? '',
    row.document ?? '',
    row.state ?? '',
    row.city ?? '',
    row.sector ?? '',
    row.company_size ?? '',
    row.temperature ?? '',
    row.stage_name ?? '',
    row.assigned_user_name ?? '',
  ].map(escapeCsvField);

  // Campos gerados: só precisam de citação.
  const generatedFields = [
    formatTicket(row.ticket_value),
    row.close_probability === null ? '' : String(row.close_probability),
    formatDate(row.expected_close_date),
    formatDate(row.last_contact_at),
  ].map(quoteCsvField);

  return [...textFields, ...generatedFields].join(CSV_SEPARATOR);
}

/**
 * CSV completo (BOM + cabeçalho + linhas + CRLF final).
 *
 * Devolve `string` porque o BOM é um caractere: quem escreve na resposta
 * converte para `Buffer` em UTF-8.
 */
export function buildLeadsCsv(rows: readonly ExportLeadRow[]): string {
  const lines = [CSV_HEADER.join(CSV_SEPARATOR), ...rows.map(rowToLine)];

  return `${UTF8_BOM}${lines.join(CSV_LINE_BREAK)}${CSV_LINE_BREAK}`;
}

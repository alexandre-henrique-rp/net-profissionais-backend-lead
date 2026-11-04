import { formatDay } from '../dashboard/period.js';
import { formatTicket } from './csv.js';
import type { ExportLeadRow } from './export.types.js';

/**
 * Gerador de PDF 1.4 mínimo — **sem dependência nova** (`TASK-S06-03`).
 *
 * O relatório é uma página A4 paisagem por bloco de 38 leads, escrita com a
 * fonte base14 Helvetica (não precisa embutir arquivo de fonte): cada página
 * tem `Contents` próprio, o `Resources` aponta para o mesmo objeto de fonte e
 * o `xref` é montado com os offsets reais dos objetos.
 *
 * Texto é gravado em Latin-1/WinAnsi (o que o Excel e o Acrobat esperam para
 * acentos em português) e os parênteses/contrabarras são escapados.
 */

/** A4 paisagem, em pontos (1/72"). */
export const PDF_PAGE_WIDTH = 842;
export const PDF_PAGE_HEIGHT = 595;

/** Margem esquerda/direita. */
const MARGIN = 40;

/** Linhas de lead por página (~38, como combinado com o produto). */
export const PDF_ROWS_PER_PAGE = 38;

/** Entrelinha do corpo da tabela, em pontos. */
const LINE_HEIGHT = 11;

/** Y do primeiro texto do corpo. */
const BODY_START_Y = 480;

/** Teto de caracteres por linha (evita texto saindo da margem direita). */
const MAX_LINE_LENGTH = 150;

/** Data de geração do relatório. */
export interface PdfOptions {
  generatedAt: Date;
  /** Sobrescreve o título padrão (`Relatório de Leads — <data>`). */
  title?: string;
}

/**
 * Transliteração para o conjunto WinAnsi.
 *
 * As aspas e travessões tipográficos não existem em Latin-1, mas existem em
 * WinAnsi — mapear para o byte certo mantém o traço do título idêntico ao
 * desenho do Penpot em vez de virar `?`.
 */
const WIN_ANSI_FROM_UNICODE: Readonly<Record<string, string>> = {
  '\u2018': '\u0091',
  '\u2019': '\u0092',
  '\u201C': '\u0093',
  '\u201D': '\u0094',
  '\u2013': '\u0096',
  '\u2014': '\u0097',
  '\u2026': '\u0085',
};

/** Caracteres fora de Latin-1/WinAnsi viram `?` (não quebram o arquivo). */
export function toWinAnsi(value: string): string {
  let output = '';

  for (const char of value) {
    const mapped = WIN_ANSI_FROM_UNICODE[char];

    if (mapped) {
      output += mapped;
      continue;
    }

    output += char.charCodeAt(0) <= 0xff ? char : '?';
  }

  return output;
}

/** Escapa `(`, `)` e `\` de uma string literal de PDF. */
export function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Converte o texto num literal de PDF pronto (`(…)`). */
function pdfString(value: string): string {
  return `(${escapePdfText(toWinAnsi(value))})`;
}

/** Corta a linha para não invadir a margem (e sinaliza o corte). */
function clip(value: string, limit = MAX_LINE_LENGTH): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** Linha de um lead na tabela textual do PDF. */
export function formatLeadLine(row: ExportLeadRow, index: number): string {
  const company = row.company_name ?? row.trade_name ?? 'Sem razão social';
  const stage = row.stage_name ?? 'Sem etapa';
  const owner = row.assigned_user_name ?? 'Sem responsável';
  const ticket = row.ticket_value === null ? '-' : `R$ ${formatTicket(row.ticket_value)}`;
  const city = [row.city, row.state].filter((part): part is string => Boolean(part)).join('/');

  return clip(
    `${index}. ${company} | ${stage} | ${owner} | ${ticket} | ${city || 'Sem cidade'}`,
  );
}

/** Stream de conteúdo de uma página (título + linhas de lead). */
function buildContentStream(title: string, lines: readonly string[]): string {
  const parts: string[] = [
    'BT',
    '/F1 16 Tf',
    `${MARGIN} ${PDF_PAGE_HEIGHT - 50} Td`,
    `${pdfString(title)} Tj`,
    'ET',
  ];

  if (lines.length > 0) {
    parts.push(
      'BT',
      '/F1 9 Tf',
      `${LINE_HEIGHT} TL`,
      `${MARGIN} ${BODY_START_Y} Td`,
    );

    for (const line of lines) {
      parts.push(`${pdfString(line)} Tj T*`);
    }

    parts.push('ET');
  }

  return parts.join('\n');
}

/** Divide as linhas em páginas de `PDF_ROWS_PER_PAGE`. */
function paginate(lines: readonly string[]): string[][] {
  if (lines.length === 0) {
    return [[]];
  }

  const pages: string[][] = [];

  for (let index = 0; index < lines.length; index += PDF_ROWS_PER_PAGE) {
    pages.push(lines.slice(index, index + PDF_ROWS_PER_PAGE));
  }

  return pages;
}

/**
 * Monta o PDF e devolve o `Buffer` completo.
 *
 * Estrutura dos objetos: `1 Catalog`, `2 Pages`, e para cada página um par
 * `Page`/`Contents`; o objeto de fonte vem por último e é compartilhado.
 */
export function buildLeadsPdf(
  rows: readonly ExportLeadRow[],
  options: PdfOptions,
): Buffer {
  const title = options.title ?? `Relatório de Leads — ${formatDay(options.generatedAt)}`;
  const lines = rows.map((row, index) => formatLeadLine(row, index + 1));
  const pages = paginate(lines);

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);
  const fontObjectId = 3 + pages.length * 2;

  const objects: string[] = [];

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`;

  pages.forEach((pageLines, index) => {
    const pageTitle = index === 0 ? title : `${title} (continuação)`;
    const content = buildContentStream(pageTitle, pageLines);

    objects[pageObjectIds[index] - 1] =
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> ` +
      `/Contents ${contentObjectIds[index]} 0 R >>`;

    objects[contentObjectIds[index] - 1] =
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\n` +
      `stream\n${content}\nendstream`;
  });

  objects[fontObjectId - 1] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets[index] = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;

  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  // Latin-1: cada caractere do texto acima já é um byte (WinAnsi), então o
  // offset em caracteres é o offset em bytes do arquivo.
  return Buffer.from(pdf, 'latin1');
}

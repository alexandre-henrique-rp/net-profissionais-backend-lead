import type { ExportLeadRow } from './export.types.js';
import {
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  PDF_ROWS_PER_PAGE,
  buildLeadsPdf,
  escapePdfText,
  formatLeadLine,
  toWinAnsi,
} from './pdf.js';

/**
 * Testes do gerador de PDF sem dependência externa.
 *
 * O contrato é estrutural: o arquivo precisa abrir em qualquer leitor (cabeçalho,
 * `xref`, `trailer`, `%%EOF`), paginar em A4 paisagem e escapar o texto.
 */

/** Linha do relatório com todos os campos vazios. */
function row(overrides: Partial<ExportLeadRow> = {}): ExportLeadRow {
  return {
    company_name: null,
    trade_name: null,
    document: null,
    state: null,
    city: null,
    sector: null,
    company_size: null,
    temperature: null,
    stage_name: null,
    assigned_user_name: null,
    ticket_value: null,
    close_probability: null,
    expected_close_date: null,
    last_contact_at: null,
    ...overrides,
  };
}

/** `n` leads distintos, para exercitar a paginação. */
function rows(count: number): ExportLeadRow[] {
  return Array.from({ length: count }, (_, index) =>
    row({ company_name: `Empresa ${index + 1}`, ticket_value: 1_000 + index }),
  );
}

/** O PDF como texto Latin-1 (o mesmo encoding em que é gravado). */
function asText(pdf: Buffer): string {
  return pdf.toString('latin1');
}

/** Quantas páginas o documento declara (o `/Type /Pages` não conta). */
function pageCount(text: string): number {
  return (text.match(/\/Type \/Page\b/g) ?? []).length;
}

const GENERATED_AT = new Date(2026, 9, 28, 9, 30, 0);

describe('buildLeadsPdf — estrutura', () => {
  it('gera um PDF 1.4 completo @spec:AC-129', () => {
    const text = asText(buildLeadsPdf(rows(3), { generatedAt: GENERATED_AT }));

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('xref');
    expect(text).toContain('trailer');
    expect(text).toContain('startxref');
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/BaseFont /Helvetica');
  });

  it('aponta o `startxref` para a tabela `xref`', () => {
    const text = asText(buildLeadsPdf(rows(2), { generatedAt: GENERATED_AT }));
    const offset = Number(/startxref\n(\d+)/.exec(text)?.[1]);

    expect(Number.isFinite(offset)).toBe(true);
    expect(text.slice(offset, offset + 4)).toBe('xref');
  });

  it('registra no `xref` o offset real de cada objeto', () => {
    const text = asText(buildLeadsPdf(rows(2), { generatedAt: GENERATED_AT }));
    const table = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(text);
    const entries = (table?.[2] ?? '').trimEnd().split('\n').slice(1);

    expect(table).not.toBeNull();
    expect(entries).toHaveLength(Number(table?.[1]) - 1);

    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));

      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
        `${index + 1} 0 obj`,
      );
    });
  });

  it('grava o `/Length` de cada stream igual ao tamanho real do conteúdo', () => {
    const text = asText(buildLeadsPdf(rows(5), { generatedAt: GENERATED_AT }));
    const streams = [...text.matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];

    expect(streams.length).toBeGreaterThan(0);

    for (const [, length, content] of streams) {
      expect(Buffer.byteLength(content, 'latin1')).toBe(Number(length));
    }
  });
});

describe('buildLeadsPdf — paginação', () => {
  it('usa A4 paisagem (842 × 595 pt)', () => {
    const text = asText(buildLeadsPdf(rows(1), { generatedAt: GENERATED_AT }));

    expect(PDF_PAGE_WIDTH).toBe(842);
    expect(PDF_PAGE_HEIGHT).toBe(595);
    expect(text).toContain('/MediaBox [0 0 842 595]');
  });

  it('cabe 38 linhas por página', () => {
    expect(PDF_ROWS_PER_PAGE).toBe(38);
    expect(pageCount(asText(buildLeadsPdf(rows(38), { generatedAt: GENERATED_AT })))).toBe(1);
    expect(pageCount(asText(buildLeadsPdf(rows(39), { generatedAt: GENERATED_AT })))).toBe(2);
  });

  it('100 linhas geram mais de uma página, todas em A4 paisagem', () => {
    const text = asText(buildLeadsPdf(rows(100), { generatedAt: GENERATED_AT }));

    expect(pageCount(text)).toBe(3);
    expect(text.match(/\/MediaBox \[0 0 842 595\]/g)).toHaveLength(3);
    expect(text).toContain('/Count 3');
    // A partir da segunda página o título é marcado como continuação.
    expect(text).toContain('continuação');
  });

  it('declara no `/Pages` o mesmo número de páginas desenhadas', () => {
    const text = asText(buildLeadsPdf(rows(80), { generatedAt: GENERATED_AT }));
    const declared = Number(/\/Count (\d+)/.exec(text)?.[1]);

    expect(declared).toBe(pageCount(text));
  });
});

describe('buildLeadsPdf — texto', () => {
  it('escapa parênteses e contrabarra do literal de PDF', () => {
    expect(escapePdfText('(a)')).toBe('\\(a\\)');
    expect(escapePdfText('C:\\temp')).toBe('C:\\\\temp');
    expect(escapePdfText('a\\b(c)')).toBe('a\\\\b\\(c\\)');
  });

  it('escapa o texto do lead dentro do stream', () => {
    const text = asText(
      buildLeadsPdf([row({ company_name: 'Solar (MG) \\ Ltda' })], {
        generatedAt: GENERATED_AT,
      }),
    );

    expect(text).toContain('Solar \\(MG\\) \\\\ Ltda');
    // Sem escape, o parêntese fecharia o literal e corromperia o stream.
    expect(text).not.toContain('(Solar (MG)');
  });

  it('translitera aspas e travessões para WinAnsi e troca o resto por `?`', () => {
    expect(toWinAnsi('“Solar”')).toBe('\u0093Solar\u0094');
    expect(toWinAnsi('a—b')).toBe('a\u0097b');
    expect(toWinAnsi('Solar ção')).toBe('Solar ção');
    expect(toWinAnsi('emoji 😀')).toBe('emoji ?');
  });

  it('lista vazia ainda gera um PDF válido com o título', () => {
    const text = asText(buildLeadsPdf([], { generatedAt: GENERATED_AT }));

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pageCount(text)).toBe(1);
    expect(text).toContain('Relatório de Leads');
    expect(text).toContain('28/10/2026');
  });

  it('aceita título customizado', () => {
    const text = asText(
      buildLeadsPdf([], { generatedAt: GENERATED_AT, title: 'Leads de Outubro' }),
    );

    expect(text).toContain('Leads de Outubro');
    expect(text).not.toContain('Relatório de Leads');
  });
});

describe('formatLeadLine', () => {
  it('resume empresa, etapa, responsável, ticket e cidade/UF', () => {
    const line = formatLeadLine(
      row({
        company_name: 'Solar Tech',
        stage_name: 'Proposta',
        assigned_user_name: 'Ana',
        ticket_value: 1234.5,
        city: 'Belo Horizonte',
        state: 'MG',
      }),
      1,
    );

    expect(line).toBe('1. Solar Tech | Proposta | Ana | R$ 1234,50 | Belo Horizonte/MG');
  });

  it('usa os rótulos de ausência quando o dado falta', () => {
    const line = formatLeadLine(row(), 2);

    expect(line).toBe('2. Sem razão social | Sem etapa | Sem responsável | - | Sem cidade');
  });

  it('cai para o nome fantasia quando não há razão social', () => {
    const line = formatLeadLine(row({ trade_name: 'Fantasia' }), 3);

    expect(line).toContain('3. Fantasia |');
  });

  it('corta linhas longas para não invadir a margem', () => {
    const line = formatLeadLine(row({ company_name: 'X'.repeat(400) }), 4);

    expect(line.length).toBe(150);
    expect(line.endsWith('…')).toBe(true);
  });
});

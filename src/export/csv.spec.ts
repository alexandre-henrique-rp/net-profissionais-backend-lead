import {
  CSV_HEADER,
  CSV_LINE_BREAK,
  CSV_SEPARATOR,
  UTF8_BOM,
  buildLeadsCsv,
  escapeCsvField,
  formatDate,
  formatTicket,
  neutralizeCsvFormula,
} from './csv.js';
import type { ExportLeadRow } from './export.types.js';

/**
 * Testes do CSV de exportação.
 *
 * O arquivo é aberto no Excel brasileiro: BOM + `;` + CRLF são requisitos de
 * interoperabilidade, e a neutralização de fórmula é requisito de segurança
 * (o `company_name` pode vir do webhook público).
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

/** Campos da única linha de dados do CSV (sem BOM/cabeçalho). */
function dataFields(overrides: Partial<ExportLeadRow> = {}): string[] {
  const lines = buildLeadsCsv([row(overrides)]).split(CSV_LINE_BREAK);

  return lines[1].split(CSV_SEPARATOR);
}

describe('buildLeadsCsv — formato do arquivo', () => {
  it('começa com BOM UTF-8 e usa `;` como separador @spec:AC-127', () => {
    const csv = buildLeadsCsv([]);

    expect(UTF8_BOM).toBe('\uFEFF');
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(CSV_SEPARATOR).toBe(';');
    expect(csv.slice(1)).toBe(`${CSV_HEADER.join(';')}${CSV_LINE_BREAK}`);
  });

  it('usa CRLF em todas as quebras de linha (RFC 4180)', () => {
    const csv = buildLeadsCsv([row({ company_name: 'Solar Tech' })]);

    expect(CSV_LINE_BREAK).toBe('\r\n');
    expect(csv.endsWith(CSV_LINE_BREAK)).toBe(true);
    // Nenhum LF solto: remover os CRLF não pode deixar quebra para trás.
    expect(csv.replaceAll(CSV_LINE_BREAK, '')).not.toContain('\n');
  });

  it('escreve o cabeçalho em português, na ordem das colunas', () => {
    const header = buildLeadsCsv([]).slice(1).split(CSV_LINE_BREAK)[0].split(';');

    expect(header).toEqual([
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
    ]);
  });

  it('escreve uma linha por lead, com todos os campos vazios quando não há dado', () => {
    const csv = buildLeadsCsv([row(), row()]);
    const lines = csv.split(CSV_LINE_BREAK);

    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(';'.repeat(13));
    expect(lines[2]).toBe(';'.repeat(13));
  });

  it('preserva acentos (o arquivo é UTF-8 com BOM)', () => {
    const csv = buildLeadsCsv([row({ company_name: 'Instalação Solar Ltda' })]);

    expect(csv).toContain('Instalação Solar Ltda');
  });
});

describe('CSV — injeção de fórmula', () => {
  it.each(['=1+1', '+1+1', '-2+3', '@SUM(1+1)'])(
    'prefixa `%s` com apóstrofo',
    (payload) => {
      const fields = dataFields({ company_name: payload });

      expect(fields[0]).toBe(`'${payload}`);
    },
  );

  it('neutraliza a fórmula antes de escapar as aspas do payload @spec:AC-128', () => {
    // O payload clássico tem aspas: o campo sai citado e com as aspas dobradas,
    // mas o apóstrofo continua sendo o primeiro caractere da célula.
    expect(escapeCsvField('=HYPERLINK("http://evil","clique")')).toBe(
      `"'=HYPERLINK(""http://evil"",""clique"")"`,
    );
  });

  it('neutraliza o gatilho mesmo escondido atrás de espaço ou TAB', () => {
    expect(neutralizeCsvFormula(' =1+1')).toBe("' =1+1");
    expect(neutralizeCsvFormula('\t=1+1')).toBe("'\t=1+1");
    expect(neutralizeCsvFormula('\r=1+1')).toBe("'\r=1+1");
  });

  it('não mexe em texto comum nem em número já formatado', () => {
    expect(neutralizeCsvFormula('Solar Tech')).toBe('Solar Tech');
    expect(neutralizeCsvFormula('12.345.678/0001-02')).toBe('12.345.678/0001-02');
    expect(escapeCsvField('1234,50')).toBe('1234,50');
  });

  it('aplica a neutralização em todos os campos textuais', () => {
    const fields = dataFields({
      company_name: '=cmd',
      trade_name: '+cmd',
      document: '-cmd',
      state: '@cmd',
      city: '=cmd',
      sector: '=cmd',
      company_size: '=cmd',
      temperature: '=cmd',
      stage_name: '=cmd',
      assigned_user_name: '=cmd',
    });

    expect(fields.slice(0, 10)).toEqual([
      "'=cmd",
      "'+cmd",
      "'-cmd",
      "'@cmd",
      "'=cmd",
      "'=cmd",
      "'=cmd",
      "'=cmd",
      "'=cmd",
      "'=cmd",
    ]);
  });
});

describe('CSV — escape de campos', () => {
  it('cita o campo que contém o separador', () => {
    expect(escapeCsvField('Silva; Filhos')).toBe('"Silva; Filhos"');
    // No arquivo, o `;` do nome fica dentro das aspas e não cria coluna nova.
    expect(buildLeadsCsv([row({ company_name: 'Silva; Filhos' })])).toContain(
      '"Silva; Filhos";',
    );
  });

  it('duplica as aspas e cita o campo', () => {
    expect(escapeCsvField('Solar "Tech" Ltda')).toBe('"Solar ""Tech"" Ltda"');
  });

  it('cita o campo que contém quebra de linha', () => {
    expect(escapeCsvField('Solar\r\nTech')).toBe('"Solar\r\nTech"');
    expect(escapeCsvField('Solar\nTech')).toBe('"Solar\nTech"');
  });
});

describe('CSV — números e datas', () => {
  it('formata o ticket com vírgula decimal e sem separador de milhar', () => {
    expect(formatTicket(1234.5)).toBe('1234,50');
    expect(formatTicket(1_000_000)).toBe('1000000,00');
    expect(formatTicket(0)).toBe('0,00');
    expect(formatTicket(null)).toBe('');
    expect(formatTicket(Number.NaN)).toBe('');
    expect(dataFields({ ticket_value: 1234.5 })[10]).toBe('1234,50');
  });

  it('formata as datas em `dd/MM/yyyy`', () => {
    expect(formatDate(new Date(2026, 9, 5, 15, 30, 0))).toBe('05/10/2026');
    expect(formatDate(null)).toBe('');

    const fields = dataFields({
      expected_close_date: new Date(2026, 11, 31),
      last_contact_at: new Date(2026, 0, 1),
    });

    expect(fields[12]).toBe('31/12/2026');
    expect(fields[13]).toBe('01/01/2026');
  });

  it('escreve a probabilidade como inteiro e vazio quando nula', () => {
    expect(dataFields({ close_probability: 75 })[11]).toBe('75');
    expect(dataFields({ close_probability: null })[11]).toBe('');
  });

  it('mantém um ticket negativo como número (não vira texto)', () => {
    expect(dataFields({ ticket_value: -10.5 })[10]).toBe('-10,50');
  });
});

import { BusinessException } from '../common/errors/business.exception.js';
import {
  DASHBOARD_PERIODS,
  DEFAULT_PERIOD,
  formatDay,
  parseDayBoundary,
  periodDateFilter,
  resolvePeriod,
} from './period.js';

/**
 * Testes dos filtros temporais (`period.ts`).
 *
 * Todo caso passa um `now` fixo: o módulo foi desenhado para não depender do
 * relógio, e é isso que permite exercitar viradas de mês/trimestre/ano.
 */

/** Quinta-feira, 15/10/2026, 14:30 no fuso do servidor. */
const NOW = new Date(2026, 9, 15, 14, 30, 0, 0);

/** Início do dia local de `NOW`. */
function startOfDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/** Último instante do dia local. */
function endOfDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

/** Captura a `BusinessException` lançada por uma chamada. */
function catchBusinessException(call: () => unknown): BusinessException {
  try {
    call();
  } catch (error) {
    if (error instanceof BusinessException) {
      return error;
    }

    throw error;
  }

  throw new Error('esperava uma BusinessException, mas nada foi lançado');
}

describe('resolvePeriod — janelas relativas', () => {
  it('`today` cobre o dia inteiro de `now`', () => {
    const range = resolvePeriod('today', undefined, undefined, NOW);

    expect(range.from).toEqual(startOfDay(2026, 10, 15));
    expect(range.to).toEqual(endOfDay(2026, 10, 15));
    expect(range.label).toBe('Hoje');
  });

  it('`last_7_days` conta hoje e os 6 dias anteriores', () => {
    const range = resolvePeriod('last_7_days', undefined, undefined, NOW);

    expect(range.from).toEqual(startOfDay(2026, 10, 9));
    expect(range.to).toEqual(endOfDay(2026, 10, 15));
    // 7 dias corridos, inclusive nas duas pontas.
    expect((range.to.getTime() - range.from.getTime()) / 86_400_000).toBeCloseTo(7, 5);
  });

  it('`this_month` vai do dia 1º ao último dia do mês corrente', () => {
    const range = resolvePeriod('this_month', undefined, undefined, NOW);

    expect(range.from).toEqual(startOfDay(2026, 10, 1));
    expect(range.to).toEqual(endOfDay(2026, 10, 31));
  });

  it('`this_month` resolve fevereiro de ano bissexto para o dia 29', () => {
    const leap = new Date(2028, 1, 10, 9, 0, 0);

    const range = resolvePeriod('this_month', undefined, undefined, leap);

    expect(range.from).toEqual(startOfDay(2028, 2, 1));
    expect(range.to).toEqual(endOfDay(2028, 2, 29));
  });

  it('`last_quarter` cobre os 3 meses corridos terminando no mês atual', () => {
    const range = resolvePeriod('last_quarter', undefined, undefined, NOW);

    expect(range.from).toEqual(startOfDay(2026, 8, 1));
    expect(range.to).toEqual(endOfDay(2026, 10, 31));
  });

  it('`last_quarter` atravessa a virada de ano (janeiro puxa novembro) @spec:AC-120', () => {
    const january = new Date(2027, 0, 20, 10, 0, 0);

    const range = resolvePeriod('last_quarter', undefined, undefined, january);

    expect(range.from).toEqual(startOfDay(2026, 11, 1));
    expect(range.to).toEqual(endOfDay(2027, 1, 31));
  });

  it('`this_year` vai de 1º de janeiro a 31 de dezembro', () => {
    const range = resolvePeriod('this_year', undefined, undefined, NOW);

    expect(range.from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(range.to).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });

  it('sem `period` usa o padrão do produto (mês corrente)', () => {
    expect(DEFAULT_PERIOD).toBe('this_month');

    const range = resolvePeriod(undefined, undefined, undefined, NOW);

    expect(range).toEqual(resolvePeriod('this_month', undefined, undefined, NOW));
  });

  it('aceita o `period` com caixa alta e espaços', () => {
    expect(resolvePeriod('  TODAY ', undefined, undefined, NOW).label).toBe('Hoje');
  });

  it('expõe exatamente as opções do dropdown do contrato', () => {
    expect([...DASHBOARD_PERIODS]).toEqual([
      'today',
      'last_7_days',
      'this_month',
      'last_quarter',
      'this_year',
      'custom',
    ]);
  });
});

describe('resolvePeriod — período personalizado', () => {
  it('usa `start_date` e `end_date` válidos como bordas do dia', () => {
    const range = resolvePeriod('custom', '2026-10-01', '2026-10-31', NOW);

    expect(range.from).toEqual(startOfDay(2026, 10, 1));
    expect(range.to).toEqual(endOfDay(2026, 10, 31));
    expect(range.label).toBe('Personalizado (01/10/2026 – 31/10/2026)');
  });

  it('aceita um único dia como intervalo', () => {
    const range = resolvePeriod('custom', '2026-10-05', '2026-10-05', NOW);

    expect(range.from).toEqual(startOfDay(2026, 10, 5));
    expect(range.to).toEqual(endOfDay(2026, 10, 5));
  });

  it('recusa `custom` sem as duas datas com 400 VALIDATION_ERROR', () => {
    const semDatas = catchBusinessException(() => resolvePeriod('custom', undefined, undefined, NOW));

    expect(semDatas.getStatus()).toBe(400);
    expect(semDatas.code).toBe('VALIDATION_ERROR');

    const soInicio = catchBusinessException(() =>
      resolvePeriod('custom', '2026-10-01', undefined, NOW),
    );

    expect(soInicio.getStatus()).toBe(400);
    expect(soInicio.code).toBe('VALIDATION_ERROR');
  });

  it('recusa intervalo invertido (`from > to`) com 400', () => {
    const error = catchBusinessException(() =>
      resolvePeriod('custom', '2026-10-31', '2026-10-01', NOW),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('posterior');
  });

  it('recusa data inexistente no calendário (30/02) com 400 @spec:AC-121', () => {
    const error = catchBusinessException(() =>
      resolvePeriod('custom', '2026-02-30', '2026-03-10', NOW),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('recusa `31/04` (abril tem 30 dias) com 400', () => {
    const error = catchBusinessException(() =>
      resolvePeriod('custom', '2026-04-31', '2026-05-10', NOW),
    );

    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('aceita 29/02 em ano bissexto', () => {
    const range = resolvePeriod('custom', '2028-02-29', '2028-03-01', NOW);

    expect(range.from).toEqual(startOfDay(2028, 2, 29));
  });
});

describe('parseDayBoundary — ISO completo', () => {
  it('usa só a parte da data do ISO completo, sem deslocar um dia', () => {
    // `2026-10-01T00:00:00.000Z` é 30/09 às 21:00 em UTC-3: interpretar como
    // instante perderia o dia 1º inteiro.
    const start = parseDayBoundary('2026-10-01T00:00:00.000Z', 'start');
    const end = parseDayBoundary('2026-10-31T23:59:59.999Z', 'end');

    expect(start).toEqual(startOfDay(2026, 10, 1));
    expect(start?.getDate()).toBe(1);
    expect(start?.getHours()).toBe(0);
    expect(end).toEqual(endOfDay(2026, 10, 31));
  });

  it('trata `AAAA-MM-DD` e o ISO completo do mesmo dia como a mesma borda', () => {
    expect(parseDayBoundary('2026-10-01T12:34:56.000Z', 'start')).toEqual(
      parseDayBoundary('2026-10-01', 'start'),
    );
  });

  it('aceita ISO com espaço no lugar do `T`', () => {
    expect(parseDayBoundary('2026-10-01 08:00:00', 'start')).toEqual(
      startOfDay(2026, 10, 1),
    );
  });

  it('devolve `null` para texto vazio, formato livre ou data inexistente', () => {
    expect(parseDayBoundary('', 'start')).toBeNull();
    expect(parseDayBoundary('01/10/2026', 'start')).toBeNull();
    expect(parseDayBoundary('2026-13-01', 'start')).toBeNull();
    expect(parseDayBoundary('2026-02-30', 'end')).toBeNull();
  });
});

describe('periodDateFilter e formatDay', () => {
  it('recorta `createdAt` entre as bordas do período', () => {
    const range = resolvePeriod('today', undefined, undefined, NOW);

    expect(periodDateFilter(range)).toEqual({
      createdAt: { gte: range.from, lte: range.to },
    });
  });

  it('formata a data em `dd/MM/yyyy`', () => {
    expect(formatDay(new Date(2026, 0, 5, 10, 0, 0))).toBe('05/01/2026');
    expect(formatDay(new Date(2026, 11, 31, 23, 0, 0))).toBe('31/12/2026');
  });
});

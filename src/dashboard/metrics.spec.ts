import {
  averageMoney,
  CONVERSION_RATE_BASIS,
  conversionRate,
  isStagnant,
  percentage,
  rate,
  STAGNANT_ALERT_MS,
  sumMoney,
  toNumber,
} from './metrics.js';

/**
 * Testes da aritmética dos dashboards.
 *
 * O que importa aqui é o JSON nunca carregar `NaN`/`Infinity`/`null`: um
 * dashboard vazio tem que devolver `0`, não quebrar o gráfico.
 */

/** Dublê mínimo do `Decimal` do Prisma (que só precisa virar número). */
function decimalLike(value: string): unknown {
  return { toString: () => value };
}

describe('conversionRate', () => {
  it('devolve percentual de 0 a 100 com 1 casa decimal', () => {
    expect(conversionRate(1, 4)).toBe(25);
    expect(conversionRate(1, 3)).toBe(33.3);
    expect(conversionRate(2, 3)).toBe(66.7);
    expect(conversionRate(3, 3)).toBe(100);
    expect(conversionRate(0, 5)).toBe(0);
  });

  it('devolve 0 (nunca `NaN`/`Infinity`) quando a base é zero', () => {
    const result = conversionRate(0, 0);

    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
    expect(conversionRate(5, 0)).toBe(0);
  });

  it('protege contra entradas corrompidas', () => {
    expect(conversionRate(Number.NaN, 10)).toBe(0);
    expect(conversionRate(1, Number.NaN)).toBe(0);
    expect(conversionRate(1, -3)).toBe(0);
  });

  it('declara a base do cálculo usada pelo frontend', () => {
    expect(CONVERSION_RATE_BASIS).toBe('won_over_total');
  });
});

describe('sumMoney e averageMoney', () => {
  it('soma valores arredondando em centavos', () => {
    expect(sumMoney([10.1, 20.2])).toBe(30.3);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('trata `null`/`undefined` como zero e lista vazia como 0', () => {
    expect(sumMoney([null, undefined, 10])).toBe(10);
    expect(sumMoney([null, undefined])).toBe(0);
    expect(sumMoney([])).toBe(0);
  });

  it('soma `Decimal` do Prisma já convertido por `toNumber`', () => {
    const values = [decimalLike('1234.50'), null, decimalLike('0.25')].map(toNumber);

    expect(values).toEqual([1234.5, null, 0.25]);
    expect(sumMoney(values)).toBe(1234.75);
  });

  it('faz a média só dos valores presentes', () => {
    expect(averageMoney([10, 20])).toBe(15);
    expect(averageMoney([10, null, 20, undefined])).toBe(15);
    expect(averageMoney([decimalLike('100'), decimalLike('50')].map(toNumber))).toBe(75);
  });

  it('devolve 0 para média sem base', () => {
    expect(averageMoney([])).toBe(0);
    expect(averageMoney([null, undefined])).toBe(0);
  });
});

describe('percentage e rate', () => {
  it('devolve percentual com 2 casas', () => {
    expect(percentage(1, 4)).toBe(25);
    expect(percentage(1, 3)).toBe(33.33);
    expect(percentage(2, 2)).toBe(100);
  });

  it('devolve 0 quando o total é zero', () => {
    expect(percentage(0, 0)).toBe(0);
    expect(percentage(7, 0)).toBe(0);
  });

  it('`rate` devolve fração com 4 casas e 0 sem denominador', () => {
    expect(rate(1, 4)).toBe(0.25);
    expect(rate(1, 3)).toBe(0.3333);
    expect(rate(1, 0)).toBe(0);
  });
});

describe('isStagnant e toNumber', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0).getTime();

  it('considera parado quem nunca foi contatado', () => {
    expect(isStagnant(null, now)).toBe(true);
  });

  it('usa o SLA de 48 horas', () => {
    expect(STAGNANT_ALERT_MS).toBe(48 * 60 * 60 * 1000);
    expect(isStagnant(new Date(now - STAGNANT_ALERT_MS + 60_000), now)).toBe(false);
    expect(isStagnant(new Date(now - STAGNANT_ALERT_MS - 60_000), now)).toBe(true);
  });

  it('converte `Decimal`, número e texto em número', () => {
    expect(toNumber(decimalLike('1234.50'))).toBe(1234.5);
    expect(toNumber('99.9')).toBe(99.9);
    expect(toNumber(42)).toBe(42);
    expect(toNumber(0)).toBe(0);
  });

  it('devolve `null` para ausente ou valor não numérico', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(decimalLike('abc'))).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

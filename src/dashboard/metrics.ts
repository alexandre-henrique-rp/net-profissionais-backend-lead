/**
 * Aritmética dos Dashboards.
 *
 * Funções puras (sem Prisma, sem `Date.now()` escondido) para que os números
 * do payload possam ser conferidos à mão e testados depois.
 */

/** SLA de inatividade comercial: 48 horas sem contato acende o alerta. */
export const STAGNANT_ALERT_MS = 48 * 60 * 60 * 1000;

/** Soma monetária arredondada em centavos (evita 0.30000000000000004). */
export function sumMoney(values: readonly (number | null | undefined)[]): number {
  const total = values.reduce<number>(
    (accumulator, value) => accumulator + (value ?? 0),
    0,
  );

  return Math.round(total * 100) / 100;
}

/** Média monetária dos valores não nulos (`0` quando não há base). */
export function averageMoney(values: readonly (number | null | undefined)[]): number {
  const present = values.filter((value): value is number => value !== null && value !== undefined);

  if (present.length === 0) {
    return 0;
  }

  return Math.round((sumMoney(present) / present.length) * 100) / 100;
}

/**
 * Taxa como fração (`0` … `1`) com 4 casas.
 *
 * Denominador zero devolve `0` — dashboard vazio não pode virar `NaN` nem
 * `null` no JSON.
 *
 * Os KPIs de conversão **não** usam mais esta função: o contrato pede
 * percentual (`conversionRate`), não fração. Fica aqui para métricas internas
 * que precisem de razão.
 */
export function rate(numerator: number, denominator: number): number {
  if (!denominator) {
    return 0;
  }

  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/** Percentual (`0` … `100`) com 2 casas; denominador zero devolve `0`. */
export function percentage(value: number, total: number): number {
  if (!total) {
    return 0;
  }

  return Math.round((value / total) * 10_000) / 100;
}

/**
 * Base da taxa de conversão dos dashboards.
 *
 * O spec (`task-s06-01` §2) define conversão como
 * `leads_converted / total_leads_month * 100` — o denominador é a **coorte
 * inteira** do período (ganhos + perdidos + em aberto + Pool), não só os
 * negócios encerrados. O campo viaja junto do número para que o frontend não
 * precise adivinhar a semântica.
 */
export const CONVERSION_RATE_BASIS = 'won_over_total' as const;

/**
 * Conversão como **percentual** (`0` … `100`) com 1 casa decimal.
 *
 * - `won / total * 100`, com `total` = leads da coorte do período;
 * - coorte vazia (`total = 0`) devolve `0` — nunca `NaN`/`Infinity`;
 * - a guarda de `Number.isFinite` cobre entradas corrompidas (`NaN` vindo de
 *   uma soma que falhou) para que o JSON nunca carregue `null`/`Infinity`.
 */
export function conversionRate(won: number, total: number): number {
  if (!Number.isFinite(won) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const value = (won / total) * 100;

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 10) / 10;
}

/**
 * Lead parado: nunca contatado ou sem contato há mais de 48 horas.
 *
 * O mesmo predicado serve ao alerta do card e ao contador do dashboard.
 */
export function isStagnant(lastContactAt: Date | null, now: number): boolean {
  if (!lastContactAt) {
    return true;
  }

  return now - lastContactAt.getTime() > STAGNANT_ALERT_MS;
}

/** `Decimal` do Prisma → `number` (o JSON não carrega `Decimal`). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value as number);

  return Number.isFinite(parsed) ? parsed : null;
}

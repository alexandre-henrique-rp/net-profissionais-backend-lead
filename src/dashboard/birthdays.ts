/**
 * Datas especiais e aniversariantes dos Dashboards.
 *
 * `LeadSpecialDate.dayMonth` guarda só `'DD/MM'` — o ano muda a cada
 * exercício, então o cálculo de "quantos dias faltam" precisa dar a volta no
 * ano (28/12 → 02/01 = 5 dias) e ignorar a hora do dia.
 */

/** Janela de antecedência mostrada no widget de relacionamento. */
export const BIRTHDAY_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_MONTH = /^(\d{2})\/(\d{2})$/;

/** Data especial como o banco a guarda. */
export interface SpecialDateParts {
  day: number;
  month: number;
}

/** Valida e decompõe `'DD/MM'`. Devolve `null` quando fora do formato. */
export function parseDayMonth(dayMonth: string): SpecialDateParts | null {
  const match = DAY_MONTH.exec(dayMonth?.trim() ?? '');

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }

  return { day, month };
}

/**
 * Dias corridos até a próxima ocorrência de `'DD/MM'`.
 *
 * - `0` = é hoje; `1` = amanhã; a contagem se repete a cada ano;
 * - datas já passadas neste ano apontam para o ano seguinte;
 * - a aritmética é feita em UTC sobre as partes da data **local** para que
 *   horário de verão não transforme 23h em 22h e mude o resultado;
 * - `29/02` em ano não bissexto cai em 1º de março (comportamento do
 *   `Date.UTC`, aceito como aproximação);
 * - entrada inválida devolve `NaN` — quem chama deve descartar o item.
 */
export function daysUntilDayMonth(dayMonth: string, today: Date): number {
  const parts = parseDayMonth(dayMonth);

  if (!parts) {
    return Number.NaN;
  }

  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  // `Date.UTC` normaliza dias inexistentes (ex.: 31/02 vira 03/03).
  const thisYearUtc = Date.UTC(today.getFullYear(), parts.month - 1, parts.day);
  const targetUtc =
    thisYearUtc < todayUtc
      ? Date.UTC(today.getFullYear() + 1, parts.month - 1, parts.day)
      : thisYearUtc;

  return Math.round((targetUtc - todayUtc) / DAY_MS);
}

/**
 * A data está dentro da janela exibida (hoje até `BIRTHDAY_WINDOW_DAYS`)?
 *
 * O limite é inclusivo dos dois lados: aniversário de hoje (`0`) e de daqui a
 * 7 dias entram na lista.
 */
export function isWithinBirthdayWindow(daysUntil: number): boolean {
  return (
    Number.isFinite(daysUntil) &&
    daysUntil >= 0 &&
    daysUntil <= BIRTHDAY_WINDOW_DAYS
  );
}

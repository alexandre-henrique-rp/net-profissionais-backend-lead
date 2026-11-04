import { BusinessException } from '../common/errors/business.exception.js';

/**
 * Filtros temporais dos Dashboards e das exportações (contrato §2.2).
 *
 * Tudo aqui é função pura: o "agora" entra como parâmetro para que o QA possa
 * exercitar viradas de mês, de trimestre e de ano sem congelar o relógio.
 */

/** Opções rápidas do dropdown de período. */
export const DASHBOARD_PERIODS = [
  'today',
  'last_7_days',
  'this_month',
  'last_quarter',
  'this_year',
  'custom',
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Período padrão do produto: mês corrente. */
export const DEFAULT_PERIOD: DashboardPeriod = 'this_month';

/** Intervalo fechado (`from <= to`) entregue às consultas Prisma. */
export interface PeriodRange {
  from: Date;
  to: Date;
}

/** Intervalo + rótulo legível devolvido no payload (`period.label`). */
export interface ResolvedPeriod extends PeriodRange {
  label: string;
}

/**
 * Prefixo de data aceito na query: `AAAA-MM-DD`, sozinho ou seguido de hora
 * (`T`/espaço) no ISO 8601 completo.
 */
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?=$|[T ])/;

/** Primeiro instante do dia local. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/** Último instante do dia local (inclusive no filtro `lte`). */
function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Primeiro instante do mês. */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/** Último instante do mês (`new Date(y, m + 1, 0)` resolve o último dia). */
function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/** `dd/MM/yyyy` no fuso local — usado em rótulos, CSV e PDF. */
export function formatDay(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * Converte o valor recebido na query (`AAAA-MM-DD` ou ISO completo) na borda
 * do dia local correspondente.
 *
 * Só a **parte da data** interessa: `2026-10-01` e
 * `2026-10-01T00:00:00.000Z` descrevem o mesmo dia do relatório. Antes, o ISO
 * completo era interpretado como instante e depois recortado para o dia local,
 * o que num fuso -03:00 puxava a janela para 30/09 e perdia um dia em cada
 * ponta.
 *
 * A data também passa por round-trip (`2026-02-30` não existe): o
 * `@IsISO8601()` valida o formato, não o calendário, e `new Date(2026, 1, 30)`
 * viraria 02/03 silenciosamente.
 */
export function parseDayBoundary(
  value: string,
  boundary: 'start' | 'end',
): Date | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  // Corta a hora (e o fuso) do ISO completo: o recorte é sempre por dia local.
  const datePart = DATE_PREFIX.exec(trimmed)?.[0];

  if (!datePart) {
    return null;
  }

  const year = Number(datePart.slice(0, 4));
  const month = Number(datePart.slice(5, 7));
  const day = Number(datePart.slice(8, 10));
  const date = new Date(year, month - 1, day);

  // Round-trip: `new Date` normaliza 30/02 para 02/03 e 31/04 para 01/05.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return boundary === 'start' ? startOfDay(date) : endOfDay(date);
}

function invalidPeriod(message: string): BusinessException {
  return new BusinessException(400, 'VALIDATION_ERROR', message);
}

/**
 * Resolve o período pedido na query no intervalo fechado de datas.
 *
 * Regras (todas ancoradas no fuso do servidor):
 * - `today`: hoje, 00:00:00.000 → 23:59:59.999;
 * - `last_7_days`: hoje e os 6 dias anteriores (7 dias corridos);
 * - `this_month`: do dia 1º ao último dia do mês corrente;
 * - `last_quarter`: os últimos 3 meses corridos, contando o mês atual — ou
 *   seja, do 1º dia do mês M-2 até o último dia do mês corrente;
 * - `this_year`: 1º de janeiro a 31 de dezembro do ano corrente;
 * - `custom`: exige `start_date` **e** `end_date` (ISO 8601); datas de
 *   calendário inválidas (30/02) e o intervalo invertido (`from > to`) são
 *   erro do cliente (`400 VALIDATION_ERROR`).
 */
export function resolvePeriod(
  period?: string | null,
  startDate?: string | null,
  endDate?: string | null,
  now: Date = new Date(),
): ResolvedPeriod {
  const selected = (period?.trim().toLowerCase() || DEFAULT_PERIOD) as DashboardPeriod;

  switch (selected) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), label: 'Hoje' };

    case 'last_7_days':
      return {
        from: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)),
        to: endOfDay(now),
        label: 'Últimos 7 dias',
      };

    case 'last_quarter':
      return {
        from: startOfMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        to: endOfMonth(now),
        label: 'Último trimestre',
      };

    case 'this_year':
      return {
        from: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        to: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
        label: 'Ano corrente',
      };

    case 'custom': {
      if (!startDate || !endDate) {
        throw invalidPeriod(
          'O período personalizado exige `start_date` e `end_date` no formato ISO 8601.',
        );
      }

      const from = parseDayBoundary(startDate, 'start');
      const to = parseDayBoundary(endDate, 'end');

      if (!from || !to) {
        throw invalidPeriod(
          '`start_date` e `end_date` devem ser datas de calendário válidas ' +
            '(AAAA-MM-DD ou ISO 8601 completo).',
        );
      }

      if (from.getTime() > to.getTime()) {
        throw invalidPeriod('`start_date` não pode ser posterior a `end_date`.');
      }

      return {
        from,
        to,
        label: `Personalizado (${formatDay(from)} – ${formatDay(to)})`,
      };
    }

    case 'this_month':
    default:
      return {
        from: startOfMonth(now),
        to: endOfMonth(now),
        label: 'Mês corrente',
      };
  }
}

/**
 * Recorte de período sobre a coluna de criação da oportunidade.
 *
 * Todas as métricas dos dashboards usam a mesma coorte (`createdAt` dentro do
 * período) para que os KPIs somem entre si.
 */
export function periodDateFilter(range: PeriodRange): {
  createdAt: { gte: Date; lte: Date };
} {
  return { createdAt: { gte: range.from, lte: range.to } };
}

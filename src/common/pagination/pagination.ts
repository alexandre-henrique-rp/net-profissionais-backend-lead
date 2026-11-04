import { BusinessException } from '../errors/business.exception.js';

/** Parâmetros de paginação já normalizados. */
export interface PageQuery {
  page: number;
  limit: number;
}

/** Metadados de uma resposta paginada (`{ items, meta }`). */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Converte um valor numérico recebido por query string.
 *
 * `NaN`/`Infinity` (ou ausência) caem no default; valores abaixo do mínimo
 * também — página 0 e limite 0 virariam consultas inválidas no Prisma, e
 * "limite 0" devolvendo 1 item é uma surpresa pior que o default do contrato.
 * Aceita string numérica: query param sem `@Type(() => Number)` chega assim e
 * cair no default silenciosamente seria pior que converter.
 */
function normalize(
  value: number | string | undefined,
  fallback: number,
): number {
  const parsed = typeof value === 'string' ? Number(value) : value;

  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.trunc(parsed);
}

/**
 * Normaliza `page`/`limit` antes de chegar ao Prisma.
 *
 * O teto de 100 é regra de produto (proteção de payload e de banco), não um
 * ajuste silencioso: pedir mais que isso é erro do cliente.
 */
export function resolvePagination(page?: number, limit?: number): PageQuery {
  const resolvedPage = normalize(page, DEFAULT_PAGE);
  const resolvedLimit = normalize(limit, DEFAULT_PAGE_SIZE);

  if (resolvedLimit > MAX_PAGE_SIZE) {
    throw new BusinessException(
      400,
      'INVALID_PAGINATION',
      `O limite máximo de itens por página é ${MAX_PAGE_SIZE}.`,
    );
  }

  return { page: resolvedPage, limit: resolvedLimit };
}

/** Monta o `meta` da resposta paginada a partir do total do banco. */
export function buildPageMeta(
  page: number,
  limit: number,
  total: number,
): PageMeta {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;

  return {
    page,
    limit,
    total: safeTotal,
    has_more: page * limit < safeTotal,
  };
}

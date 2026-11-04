import type { TenantLeadStatus } from '../generated/prisma/client.js';

/**
 * Códigos de erro de contrato usados pelo módulo de leads.
 *
 * `LEAD_ALREADY_EXISTS`, `LEAD_ALREADY_ASSIGNED`, `VERSION_CONFLICT` e
 * `LEAD_NOT_FOUND` vêm do contrato compartilhado; `DAILY_CLAIM_LIMIT_EXCEEDED`
 * é regra do pool (`TASK-S03-04`, 20 captações por usuário por dia) e
 * `STAGE_NOT_CONFIGURED` cobre o tenant que ainda não tem etapas — caso que só
 * acontece com seed incompleto, mas que não pode virar 500 opaco.
 */
export const LEAD_ERROR_CODES = {
  alreadyExists: 'LEAD_ALREADY_EXISTS',
  alreadyAssigned: 'LEAD_ALREADY_ASSIGNED',
  versionConflict: 'VERSION_CONFLICT',
  leadNotFound: 'LEAD_NOT_FOUND',
  userNotFound: 'USER_NOT_FOUND',
  dailyClaimLimitExceeded: 'DAILY_CLAIM_LIMIT_EXCEEDED',
  stageNotConfigured: 'STAGE_NOT_CONFIGURED',
} as const;

/** Cota diária de captações por usuário (`TASK-S03-04`). */
export const DAILY_CLAIM_LIMIT = 20;

/** Status em que o lead está visível para captação no Pool. */
export const POOL_STATUSES: TenantLeadStatus[] = ['AVAILABLE', 'RETURNED_TO_POOL'];

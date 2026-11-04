/**
 * Origens que o webhook de captura passiva aceita.
 *
 * O integrador informa de onde o lead veio; o valor alimenta o Dashboard
 * (Google Ads × Meta Ads × orgânico) e a primeira nota da linha do tempo.
 */
export const WEBHOOK_SOURCES = [
  'landing_page',
  'google_ads',
  'meta_ads',
  'indicacao',
  'outbound',
  'webhook_api',
] as const;

export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

/** Origem usada quando o integrador não manda nem `source` nem `channel`. */
export const DEFAULT_WEBHOOK_SOURCE: WebhookSource = 'webhook_api';

/** Prefixo da chave de idempotência no Redis (`webhook:idem:<tenant>:<key>`). */
export const WEBHOOK_IDEMPOTENCY_PREFIX = 'webhook:idem:';

/** Janela de idempotência: 24 horas (reenvio do integrador não duplica). */
export const WEBHOOK_IDEMPOTENCY_TTL = 24 * 60 * 60;

/** Tolerância do `X-Timestamp`: 5 minutos para cada lado. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

/**
 * Códigos de erro do webhook público.
 *
 * `INVALID_SIGNATURE` e `LGPD_CONSENT_REQUIRED` vêm da tabela compartilhada;
 * `NOT_FOUND` é o código genérico para corporação inexistente (o contrato não
 * tem um `TENANT_NOT_FOUND`) e `VALIDATION_ERROR` cobre documento malformado.
 */
export const WEBHOOK_ERROR_CODES = {
  invalidSignature: 'INVALID_SIGNATURE',
  lgpdConsentRequired: 'LGPD_CONSENT_REQUIRED',
  notFound: 'NOT_FOUND',
  validationError: 'VALIDATION_ERROR',
  unprocessable: 'UNPROCESSABLE_ENTITY',
} as const;

/** Id fora deste formato estouraria no Postgres (coluna `uuid`). */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

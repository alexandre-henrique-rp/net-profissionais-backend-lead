import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessException } from '../common/errors/business.exception.js';
import {
  SIGNATURE_TOLERANCE_SECONDS,
  WEBHOOK_ERROR_CODES,
} from './webhook.constants.js';

/** Prefixo opcional do header de assinatura (`sha256=<hex>`). */
const SIGNATURE_PREFIX = 'sha256=';

/** Timestamp puramente numérico é interpretado como epoch em segundos. */
const EPOCH_SECONDS = /^\d{9,12}$/;

/** Só hexadecimal: qualquer outro caractere já invalida a assinatura. */
const HEX_ONLY = /^[0-9a-f]+$/;

/**
 * HMAC-SHA256 do corpo bruto com o `webhookToken` da corporação.
 *
 * O corpo precisa ser **exatamente** o que o integrador enviou — por isso o
 * cálculo usa `rawBody`, e não o objeto já parseado (que perde ordem de chaves,
 * espaços e escape de acentos).
 */
export function computeSignature(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Normaliza o header `X-Signature`: aceita `sha256=<hex>` e `<hex>`, com
 * maiúsculas ou minúsculas.
 */
export function normalizeSignature(header: string): string {
  const trimmed = header.trim();
  const withoutPrefix = trimmed.toLowerCase().startsWith(SIGNATURE_PREFIX)
    ? trimmed.slice(SIGNATURE_PREFIX.length)
    : trimmed;

  return withoutPrefix.trim().toLowerCase();
}

/**
 * Compara duas assinaturas em tempo constante.
 *
 * Aceita o valor do header cru (`sha256=<hex>` ou `<hex>`, maiúsculas ou não)
 * porque a normalização vive aqui: nenhum chamador precisa lembrar dela.
 * `timingSafeEqual` estoura quando os buffers têm tamanhos diferentes, então o
 * tamanho é conferido antes — e uma assinatura que nem é hexadecimal já cai
 * fora sem tocar no buffer.
 */
export function signaturesMatch(expectedHex: string, receivedHex: string): boolean {
  const normalized = normalizeSignature(receivedHex);

  if (!normalized || !HEX_ONLY.test(normalized)) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(normalized, 'hex');

  if (expected.length === 0 || expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

/**
 * Lê o `X-Timestamp` como epoch em segundos.
 *
 * Aceita ISO 8601 (`2026-10-23T14:30:00Z`) ou epoch (`1761232200`), que são as
 * duas formas que integradores costumam mandar. Valor inválido → `null`.
 */
export function parseTimestampSeconds(value?: string): number | null {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  if (EPOCH_SECONDS.test(raw)) {
    const numeric = Number(raw);

    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
  }

  const parsed = Date.parse(raw);

  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

/**
 * Corpo bruto da requisição para o cálculo do HMAC.
 *
 * `req.rawBody` só existe quando o app é criado com `bodyParser: false` e um
 * parser `raw({ type: 'application/json' })` (ver comentário no
 * `WebhookController`). Enquanto o orquestrador não liga esse parser, o
 * fallback serializa o corpo já parseado — funciona para corpos canônicos
 * (`JSON.stringify` sem espaços), mas não é à prova de reordenação de chaves.
 */
export function extractRawBody(request: RawBodyRequest<Request>): Buffer {
  if (request.rawBody) {
    return request.rawBody;
  }

  return Buffer.from(JSON.stringify(request.body ?? {}), 'utf8');
}

/** 401 `INVALID_SIGNATURE` — assinatura, timestamp ou token fora do esperado. */
function invalidSignature(message: string): BusinessException {
  return new BusinessException(401, WEBHOOK_ERROR_CODES.invalidSignature, message);
}

/**
 * Valida a dupla (assinatura + janela de tempo) de uma requisição de webhook.
 *
 * Vive aqui, e não no service, porque o guard e o service precisam exatamente
 * da mesma decisão: o guard roda antes da validação do corpo (um payload
 * inválido nunca deve "esconder" que a assinatura estava errada) e o service
 * repete a checagem para continuar correto quando chamado por dentro.
 *
 * Todas as falhas usam o mesmo código (401 `INVALID_SIGNATURE`): o integrador
 * precisa saber que o problema é a credencial, não descobrir quais regras
 * internas passaram. A mensagem detalha o que corrigir para quem já tem a
 * chave (ex.: janela do `X-Timestamp`).
 */
export function assertSignatureIsValid(params: {
  rawBody: Buffer;
  secret: string;
  signature?: string;
  timestamp?: string;
}): void {
  const received = params.signature ? normalizeSignature(params.signature) : '';

  if (received.length === 0) {
    throw invalidSignature('Assinatura ausente: envie o header X-Signature.');
  }

  const expected = computeSignature(params.rawBody, params.secret);

  if (!signaturesMatch(expected, received)) {
    throw invalidSignature('A assinatura HMAC do corpo não confere com o token desta corporação.');
  }

  const sentAt = parseTimestampSeconds(params.timestamp);

  if (sentAt === null) {
    throw invalidSignature('Timestamp ausente ou inválido: envie o header X-Timestamp.');
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - sentAt);

  if (skew > SIGNATURE_TOLERANCE_SECONDS) {
    throw invalidSignature(
      `Timestamp fora da janela de ${SIGNATURE_TOLERANCE_SECONDS / 60} minutos (proteção contra replay).`,
    );
  }
}

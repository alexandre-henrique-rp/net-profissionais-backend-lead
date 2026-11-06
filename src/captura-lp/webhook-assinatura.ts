import { computeSignature } from '../webhook/webhook.signature.js';

/**
 * Prefixo do header `X-Signature`.
 *
 * O webhook aceita o hex puro ou `sha256=<hex>`; o prefixo é o formato que a
 * documentação do integrador usa, então é o que sai daqui.
 */
export const PREFIXO_ASSINATURA = 'sha256=';

/**
 * Janela de tolerância do `X-Timestamp`, em segundos.
 *
 * Mesma janela que o webhook aplica (5 minutos): se o relé reassinasse com
 * um timestamp de outra ordem de grandeza, a assinatura seria recusada.
 */
export const JANELA_TIMESTAMP_SEGUNDOS = 5 * 60;

/** Cabeçalhos que toda entrega ao webhook leva. */
export interface CabecalhosDeEnvio extends Record<string, string> {
  'Content-Type': string;
  'X-Signature': string;
  'X-Timestamp': string;
  'Idempotency-Key': string;
}

/**
 * Assina o corpo **exatamente como ele vai ser enviado**.
 *
 * O HMAC é calculado sobre os bytes crus: serializar de novo (ou reordenar as
 * chaves) produziria outra assinatura e o webhook responderia 401. Por isso o
 * corpo é serializado uma única vez, longe daqui, e os mesmos bytes são
 * assinados e enviados.
 *
 * @param corpoBruto texto que vai no corpo da requisição.
 * @param segredo token do webhook (nunca sai do servidor).
 * @returns hex minúsculo do HMAC-SHA256.
 */
export function assinarCorpo(corpoBruto: string, segredo: string): string {
  return computeSignature(Buffer.from(corpoBruto, 'utf8'), segredo);
}

/**
 * Monta os cabeçalhos de uma entrega ao webhook.
 *
 * - `X-Signature`: HMAC do corpo bruto, no formato `sha256=<hex>`;
 * - `X-Timestamp`: epoch em segundos — dentro da janela de ±5 minutos;
 * - `Idempotency-Key`: chave estável de quem pediu a entrega, para o reenvio
 *   não virar lead duplicado.
 *
 * @param params corpo já serializado, segredo, chave de idempotência e o
 *   instante (em ms) usado no timestamp — injetável para teste determinístico.
 */
export function montarCabecalhosDeEnvio(params: {
  corpoBruto: string;
  segredo: string;
  idempotencyKey: string;
  agoraMs?: number;
}): CabecalhosDeEnvio {
  const agoraMs = params.agoraMs ?? Date.now();
  const assinatura = assinarCorpo(params.corpoBruto, params.segredo);

  return {
    'Content-Type': 'application/json',
    'X-Signature': `${PREFIXO_ASSINATURA}${assinatura}`,
    'X-Timestamp': Math.floor(agoraMs / 1000).toString(),
    'Idempotency-Key': params.idempotencyKey,
  };
}

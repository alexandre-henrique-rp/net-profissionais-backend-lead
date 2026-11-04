import { SetMetadata } from '@nestjs/common';

/** Chave do metadado lido pelo `ApiResponseInterceptor`. */
export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/**
 * Devolve o corpo do handler exatamente como ele saiu, sem o envelope
 * `{ success, data, meta }`.
 *
 * Existe para rotas cujo contrato é o corpo cru: o healthcheck `AC-001` exige
 * `{"status":"ok"}` — qualquer embrulho quebra o consumidor (orquestrador,
 * load balancer). O decorator vale na rota ou no controller inteiro.
 */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);

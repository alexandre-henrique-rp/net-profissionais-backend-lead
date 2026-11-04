import { HttpException } from '@nestjs/common';

/**
 * Erro de regra de negócio com código próprio de contrato.
 *
 * Existe porque `BadRequestException('texto livre')` não dá ao frontend nada
 * estável para reagir: o cliente precisa do `code` (`LEAD_ALREADY_ASSIGNED`,
 * `TOKEN_EXPIRED`, ...) e não da frase em português, que pode mudar.
 *
 * O payload passado ao `HttpException` leva `code` e `message` para que
 * `exception.message` continue legível em logs e no filtro global.
 */
export class BusinessException extends HttpException {
  /** Código de contrato consumido pelo frontend. */
  readonly code: string;

  /** Informação adicional opcional (ex.: lista de campos inválidos). */
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}

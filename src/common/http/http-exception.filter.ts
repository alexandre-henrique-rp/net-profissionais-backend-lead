import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BusinessException } from '../errors/business.exception.js';

/**
 * Status HTTP → código de erro padrão do contrato.
 *
 * Quando o módulo não tem um código de negócio próprio, é este mapa que o
 * frontend recebe — por isso ele é a única fonte (filtro e testes leem daqui).
 */
const STATUS_CODE_MAP: Readonly<Record<number, string>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'GONE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMIT_EXCEEDED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

/** Código de erro padrão para um status HTTP. */
export function errorCodeForStatus(status: number): string {
  return STATUS_CODE_MAP[status] ?? 'HTTP_ERROR';
}

/** Item de validação derivado das mensagens do `class-validator`. */
interface ValidationIssue {
  field?: string;
  issue: string;
}

interface ErrorPayload {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Corpo de erro devolvido ao cliente. */
export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  retry_after_seconds?: number;
  timestamp: string;
}

export interface ErrorEnvelope {
  success: false;
  error: ErrorBody;
}

/** Primeira palavra da mensagem, quando ela parece o nome do campo. */
const FIELD_PREFIX = /^([A-Za-z_][\w.]*)\s+/;

/**
 * Traduz a saída do `class-validator` em `{ field, issue }`.
 *
 * As mensagens padrão começam com o nome da propriedade
 * ("email must be an email"). Quando não começam, `field` fica de fora em vez
 * de inventar um valor.
 */
function toValidationIssue(raw: unknown): ValidationIssue {
  const issue = String(raw);
  const match = FIELD_PREFIX.exec(issue);

  return match ? { field: match[1], issue } : { issue };
}

/** Extrai mensagem e detalhes de um payload de `HttpException`. */
function readHttpPayload(
  payload: unknown,
  fallback: string,
): { message: string; details?: unknown } {
  if (typeof payload === 'string' && payload.trim() !== '') {
    return { message: payload };
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const rawMessage = record.message;

    // ValidationPipe devolve `message` como lista de violações.
    if (Array.isArray(rawMessage)) {
      const messages = rawMessage.map((item) => String(item));
      return {
        message: messages.join('; ') || fallback,
        details: messages.map(toValidationIssue),
      };
    }

    if (typeof rawMessage === 'string' && rawMessage.trim() !== '') {
      return { message: rawMessage };
    }

    if (typeof record.error === 'string' && record.error.trim() !== '') {
      return { message: record.error };
    }
  }

  return { message: fallback };
}

/**
 * Lê o `Retry-After` (segundos ou data HTTP) do response ou do request.
 *
 * Só existe corpo com `retry_after_seconds` em 429 — nos outros erros o campo
 * é omitido para o frontend diferenciar "espere X segundos" de "tente de novo".
 */
function readRetryAfterSeconds(
  response: Response,
  request: Request,
): number | undefined {
  const header =
    response.getHeader('retry-after') ?? request.headers['retry-after'];
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return seconds > 0 ? Math.ceil(seconds) : undefined;
  }

  // Formato de data HTTP: converte a diferença para segundos.
  const target = Date.parse(String(value));

  if (Number.isNaN(target)) {
    return undefined;
  }

  const diff = Math.ceil((target - Date.now()) / 1000);
  return diff > 0 ? diff : undefined;
}

/**
 * Filtro global de exceções.
 *
 * Toda resposta de erro tem o mesmo envelope, então o cliente do frontend
 * trata `code` de forma uniforme — inclusive para erros inesperados, que nunca
 * expõem stack trace.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const error = this.describe(exception);

    // 4xx é falha do cliente (ruído esperado); 5xx merece stack no log.
    if (error.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${error.status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      timestamp: new Date().toISOString(),
    };

    if (error.status === 429) {
      const retryAfter = readRetryAfterSeconds(response, request);

      if (retryAfter !== undefined) {
        body.retry_after_seconds = retryAfter;
      }
    }

    const envelope: ErrorEnvelope = { success: false, error: body };

    response.status(error.status).json(envelope);
  }

  private describe(exception: unknown): ErrorPayload {
    if (exception instanceof BusinessException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const fallback = exception.message || 'Erro na requisição.';
      const { message, details } = readHttpPayload(
        exception.getResponse(),
        fallback,
      );

      return { status, code: errorCodeForStatus(status), message, details };
    }

    // Erro não-HTTP: mensagem genérica de propósito — o detalhe fica no log.
    return {
      status: 500,
      code: errorCodeForStatus(500),
      message: 'Erro interno do servidor.',
    };
  }
}

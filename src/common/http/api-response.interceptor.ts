import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  Optional,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { type Observable, map } from 'rxjs';
import { SKIP_ENVELOPE_KEY } from './skip-envelope.decorator.js';

/** Metadados anexados a toda resposta de sucesso. */
export interface ResponseMeta {
  timestamp: string;
  version: string;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

const API_VERSION = 'v1';

/** `StreamableFile` é o tipo do Nest para download; não pode ser serializado. */
function isStreamableFile(value: unknown): boolean {
  return value instanceof StreamableFile;
}

/** Streams crus (readable) também são escritos direto no response. */
function isReadableStream(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { pipe?: unknown };
  return typeof candidate.pipe === 'function';
}

/**
 * Já é um envelope de resposta (ex.: handler que devolve `success`).
 * Reembrulhar mudaria o formato que o frontend já conhece.
 */
function isEnvelope(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'success' in value;
}

/**
 * Envelope global de sucesso: `{ success, data, meta }`.
 *
 * Controllers devolvem o dado cru — o formato fica num lugar só, e nenhum
 * módulo precisa lembrar de embrulhar.
 *
 * Exportações (`text/csv`, `application/pdf`) e streams passam intactos:
 * envolvê-los em JSON quebraria o download do módulo de exportação.
 *
 * Rotas marcadas com `@SkipEnvelope()` também passam intactas: o contrato
 * delas é o corpo cru (healthcheck, por exemplo).
 */
@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(
    /**
     * Opcional para que o interceptor continue instanciável sem DI (testes
     * unitários). Sem o reflector, o envelope é o comportamento padrão.
     */
    @Optional() private readonly reflector?: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    // Lido antes do `map` porque o metadado não muda durante a requisição.
    const skipEnvelope =
      this.reflector?.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        // 204 (e afins) não têm corpo: embrulhar geraria body em resposta vazia.
        if (response.statusCode === 204) {
          return data;
        }

        if (skipEnvelope) {
          return data;
        }

        const contentType = String(response.getHeader('content-type') ?? '');

        if (
          isStreamableFile(data) ||
          isReadableStream(data) ||
          Buffer.isBuffer(data)
        ) {
          return data;
        }

        if (contentType !== '' && !contentType.includes('application/json')) {
          return data;
        }

        if (isEnvelope(data)) {
          return data;
        }

        const envelope: SuccessEnvelope<unknown> = {
          success: true,
          data,
          meta: { timestamp: new Date().toISOString(), version: API_VERSION },
        };

        return envelope;
      }),
    );
  }
}

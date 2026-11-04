import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { BusinessException } from '../errors/business.exception.js';
import {
  type ErrorBody,
  type ErrorEnvelope,
  HttpExceptionFilter,
  errorCodeForStatus,
} from './http-exception.filter.js';

interface FakeResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body?: ErrorEnvelope;
  status(code: number): FakeResponse;
  json(body: ErrorEnvelope): FakeResponse;
  getHeader(name: string): unknown;
}

interface FakeHostOptions {
  retryAfterHeader?: string;
  method?: string;
  url?: string;
}

/** Host HTTP mínimo: captura status e corpo escritos pelo filtro. */
function createHost(options: FakeHostOptions = {}): {
  host: ArgumentsHost;
  response: FakeResponse;
} {
  const response: FakeResponse = {
    statusCode: 0,
    headers: {},
    status(code: number): FakeResponse {
      response.statusCode = code;
      return response;
    },
    json(body: ErrorEnvelope): FakeResponse {
      response.body = body;
      return response;
    },
    getHeader(name: string): unknown {
      return response.headers[name.toLowerCase()];
    },
  };

  if (options.retryAfterHeader !== undefined) {
    response.headers['retry-after'] = options.retryAfterHeader;
  }

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        method: options.method ?? 'POST',
        url: options.url ?? '/api/v1/auth/login',
        headers: {},
      }),
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

/** Roda o filtro e devolve o corpo escrito na resposta. */
function catchAndRead(
  exception: unknown,
  options: FakeHostOptions = {},
): { response: FakeResponse; body: ErrorEnvelope } {
  const { host, response } = createHost(options);

  new HttpExceptionFilter().catch(exception, host);

  return { response, body: response.body as ErrorEnvelope };
}

describe('HttpExceptionFilter', () => {
  beforeEach(() => {
    // 5xx é logado com stack; o teste não precisa poluir a saída.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserva status, code e details de uma BusinessException @spec:AC-064', () => {
    const details = { fields: ['reassign_to_user_id'] };
    const { response, body } = catchAndRead(
      new BusinessException(
        422,
        'LAST_ADMIN',
        'Último administrador.',
        details,
      ),
    );

    expect(response.statusCode).toBe(422);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('LAST_ADMIN');
    expect(body.error.message).toBe('Último administrador.');
    expect(body.error.details).toEqual(details);
    expect(Number.isNaN(Date.parse(body.error.timestamp))).toBe(false);
  });

  it('traduz o 400 do ValidationPipe em VALIDATION_ERROR com as mensagens unidas', () => {
    const { response, body } = catchAndRead(
      new BadRequestException({
        statusCode: 400,
        message: ['email must be an email', 'password should not be empty'],
        error: 'Bad Request',
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe(
      'email must be an email; password should not be empty',
    );

    const details = body.error.details as Array<{
      field?: string;
      issue: string;
    }>;
    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({
      field: 'email',
      issue: 'email must be an email',
    });
    expect(details[1].field).toBe('password');
  });

  it('usa o code do mapa quando a HttpException não tem código de negócio', () => {
    const { response, body } = catchAndRead(
      new UnauthorizedException('Autenticação necessária.'),
    );

    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Autenticação necessária.');
  });

  it('converte erro inesperado em 500 INTERNAL_ERROR sem stack no corpo', () => {
    const failure = new Error('conexão com o banco caiu em /var/secrets');
    const { response, body } = catchAndRead(failure);

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Erro interno do servidor.');
    expect(body.error).not.toHaveProperty('details');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('conexão com o banco caiu');
    expect(serialized).not.toContain('at Error');
    expect(serialized).not.toContain('stack');
  });

  it('inclui retry_after_seconds no 429 a partir do header Retry-After', () => {
    const { response, body } = catchAndRead(
      new HttpException('Muitas tentativas.', 429),
      { retryAfterHeader: '900' },
    );

    expect(response.statusCode).toBe(429);
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.retry_after_seconds).toBe(900);
  });

  it('omite retry_after_seconds em erros que não são 429', () => {
    const { body } = catchAndRead(
      new BusinessException(
        400,
        'INVALID_PAGINATION',
        'Limite máximo excedido.',
      ),
      { retryAfterHeader: '900' },
    );

    expect(body.error).not.toHaveProperty('retry_after_seconds');
  });

  it('não inventa retry_after_seconds quando o 429 não traz o header', () => {
    const { body } = catchAndRead(new HttpException('Muitas tentativas.', 429));

    expect(body.error).not.toHaveProperty('retry_after_seconds');
  });

  it('mapeia todos os status do contrato para o código de erro padrão', () => {
    const esperado: Record<number, string> = {
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

    for (const [status, code] of Object.entries(esperado)) {
      expect(errorCodeForStatus(Number(status))).toBe(code);
    }

    expect(errorCodeForStatus(418)).toBe('HTTP_ERROR');
  });

  it('devolve o corpo com o envelope de erro completo', () => {
    const { body } = catchAndRead(new HttpException('Recurso ausente.', 404));

    const error: ErrorBody = body.error;
    expect(Object.keys(body).sort()).toEqual(['error', 'success']);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Recurso ausente.');
  });
});

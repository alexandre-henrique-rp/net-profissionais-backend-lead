import { Readable } from 'node:stream';
import {
  type CallHandler,
  type ExecutionContext,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { ApiResponseInterceptor } from './api-response.interceptor.js';
import { SkipEnvelope } from './skip-envelope.decorator.js';

/** Controller cujo método pede o corpo cru (contrato do `GET /health`). */
class HealthController {
  @SkipEnvelope()
  check(): { status: string } {
    return { status: 'ok' };
  }
}

/** Controller inteiro fora do envelope. */
@SkipEnvelope()
class RawController {
  check(): { status: string } {
    return { status: 'ok' };
  }
}

/** Controller comum: tudo passa pelo envelope. */
class DefaultController {
  check(): { status: string } {
    return { status: 'ok' };
  }
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  getHeader(name: string): string | undefined;
}

/** Contexto HTTP mínimo, com resposta falsa que só registra cabeçalhos. */
function createContext(options: {
  handler?: () => unknown;
  cls?: new () => unknown;
  response?: Partial<FakeResponse>;
  type?: string;
}): { context: ExecutionContext; response: FakeResponse } {
  const response: FakeResponse = {
    statusCode: 200,
    headers: {},
    getHeader(name: string): string | undefined {
      return response.headers[name.toLowerCase()];
    },
    ...options.response,
  };

  const context = {
    getType: () => options.type ?? 'http',
    getHandler: () => options.handler ?? DefaultController.prototype.check,
    getClass: () => options.cls ?? DefaultController,
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({}),
    }),
  } as unknown as ExecutionContext;

  return { context, response };
}

/** Roda o interceptor como o Nest faria e devolve o corpo final. */
async function run(context: ExecutionContext, data: unknown): Promise<unknown> {
  const interceptor = new ApiResponseInterceptor(new Reflector());
  const next: CallHandler = { handle: () => of(data) };

  return lastValueFrom(interceptor.intercept(context, next));
}

describe('ApiResponseInterceptor', () => {
  it('embrulha o retorno do handler em success/data/meta @spec:AC-063', async () => {
    const { context } = createContext({});

    const body = (await run(context, { id: 'lead-1' })) as {
      success: boolean;
      data: unknown;
      meta: { timestamp: string; version: string };
    };

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 'lead-1' });
    expect(body.meta.version).toBe('v1');
    expect(Number.isNaN(Date.parse(body.meta.timestamp))).toBe(false);
    expect(new Date(body.meta.timestamp).toISOString()).toBe(
      body.meta.timestamp,
    );
  });

  it('mantém o corpo cru quando o método tem @SkipEnvelope (healthcheck) @spec:AC-066', async () => {
    const { context } = createContext({
      handler: HealthController.prototype.check,
      cls: HealthController,
    });

    await expect(run(context, { status: 'ok' })).resolves.toEqual({
      status: 'ok',
    });
  });

  it('mantém o corpo cru quando o @SkipEnvelope está no controller', async () => {
    const { context } = createContext({
      handler: RawController.prototype.check,
      cls: RawController,
    });

    await expect(run(context, { status: 'ok' })).resolves.toEqual({
      status: 'ok',
    });
  });

  it('não embrulha StreamableFile (download)', async () => {
    const { context } = createContext({});
    const file = new StreamableFile(Buffer.from('relatorio'));

    await expect(run(context, file)).resolves.toBe(file);
  });

  it('não embrulha Buffer binário', async () => {
    const { context } = createContext({});
    const buffer = Buffer.from('id,nome\n1,Ana');

    const body = await run(context, buffer);

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body).toBe(buffer);
  });

  it('não embrulha stream cru (exportação em streaming)', async () => {
    const { context } = createContext({});
    const stream = Readable.from(['a', 'b']);

    await expect(run(context, stream)).resolves.toBe(stream);
  });

  it('não embrulha resposta com content-type que não é JSON (CSV)', async () => {
    const { context } = createContext({
      response: { headers: { 'content-type': 'text/csv; charset=utf-8' } },
    });

    await expect(run(context, 'id,nome\n1,Ana')).resolves.toBe(
      'id,nome\n1,Ana',
    );
  });

  it('embrulha normalmente quando o content-type é JSON', async () => {
    const { context } = createContext({
      response: {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    });

    const body = (await run(context, { ok: true })) as {
      success?: boolean;
      data?: unknown;
    };

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ ok: true });
  });

  it('não embrulha duas vezes um corpo que já tem success', async () => {
    const { context } = createContext({});
    const already = { success: false, error: { code: 'X' } };

    await expect(run(context, already)).resolves.toBe(already);
  });

  it('não cria corpo para resposta 204', async () => {
    const { context } = createContext({ response: { statusCode: 204 } });

    await expect(run(context, undefined)).resolves.toBeUndefined();
  });

  it('não embrulha respostas de contexto que não é HTTP', async () => {
    const { context } = createContext({ type: 'rpc' });

    await expect(run(context, { status: 'ok' })).resolves.toEqual({
      status: 'ok',
    });
  });
});

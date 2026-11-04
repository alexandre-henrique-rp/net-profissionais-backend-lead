import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BusinessException } from '../errors/business.exception.js';
import type { AuthUser, AuthenticatedRequest } from './auth.types.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { Public } from './public.decorator.js';
import { SESSION_COOKIE_NAME, type SessionService } from './session.service.js';

const JWT_SECRET = 'segredo-de-teste';

// O guard assina/valida com o segredo do ambiente; o teste fixa um valor.
vi.mock('../../config/env.js', () => ({
  env: () => ({ JWT_SECRET: 'segredo-de-teste' }),
}));

const SESSION: AuthUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'sess-1',
  role: 'ADMIN',
  operationalRole: 'ADMIN',
};

class RotaProtegida {
  handler(): void {}
}

class RotaPublica {
  @Public()
  handler(): void {}
}

interface ContextOptions {
  handler?: () => void;
  cls?: new () => unknown;
  request?: Partial<AuthenticatedRequest> & {
    cookies?: Record<string, string>;
  };
}

function createContext(options: ContextOptions = {}): {
  context: ExecutionContext;
  request: AuthenticatedRequest & { cookies: Record<string, string> };
} {
  const request = {
    cookies: {},
    headers: {},
    ...options.request,
  } as AuthenticatedRequest & { cookies: Record<string, string> };

  const context = {
    getHandler: () => options.handler ?? RotaProtegida.prototype.handler,
    getClass: () => options.cls ?? RotaProtegida,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

/** Extrai o BusinessException lançado (ou falha se nada for lançado). */
async function catchBusinessError(
  promise: Promise<unknown>,
): Promise<BusinessException> {
  const resultado = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(resultado).toBeInstanceOf(BusinessException);
  return resultado as BusinessException;
}

describe('JwtAuthGuard', () => {
  let sessionService: { read: ReturnType<typeof vi.fn> };
  let jwtService: JwtService;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    sessionService = { read: vi.fn() };
    jwtService = new JwtService({ secret: JWT_SECRET });
    guard = new JwtAuthGuard(
      new Reflector(),
      sessionService as unknown as SessionService,
      jwtService,
    );
  });

  it('libera rota @Public() sem exigir credencial @spec:AC-045', async () => {
    const { context, request } = createContext({
      handler: RotaPublica.prototype.handler,
      cls: RotaPublica,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(sessionService.read).not.toHaveBeenCalled();
  });

  it('responde 401 UNAUTHORIZED sem cookie e sem Bearer @spec:AC-045', async () => {
    const { context } = createContext();

    const error = await catchBusinessError(guard.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('responde 401 SESSION_EXPIRED quando o cookie aponta para sessão inexistente', async () => {
    sessionService.read.mockResolvedValue(null);
    const { context } = createContext({
      request: { cookies: { [SESSION_COOKIE_NAME]: 'sessao-morta' } },
    });

    const error = await catchBusinessError(guard.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(sessionService.read).toHaveBeenCalledWith('sessao-morta');
  });

  it('popula request.user com o cookie válido', async () => {
    sessionService.read.mockResolvedValue(SESSION);
    const { context, request } = createContext({
      request: { cookies: { [SESSION_COOKIE_NAME]: 'sess-1' } },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(SESSION);
  });

  it('aceita Bearer válido cuja sessão ainda existe', async () => {
    sessionService.read.mockResolvedValue(SESSION);
    const token = await jwtService.signAsync(
      { sessionId: 'sess-1' },
      { secret: JWT_SECRET },
    );
    const { context, request } = createContext({
      request: { headers: { authorization: `Bearer ${token}` } },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(SESSION);
    expect(sessionService.read).toHaveBeenCalledWith('sess-1');
  });

  it('recusa Bearer válido sem sessionId (token não revogável) @spec:AC-046', async () => {
    const token = await jwtService.signAsync(
      { sub: 'user-1' },
      { secret: JWT_SECRET },
    );
    const { context } = createContext({
      request: { headers: { authorization: `Bearer ${token}` } },
    });

    const error = await catchBusinessError(guard.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(sessionService.read).not.toHaveBeenCalled();
  });

  it('recusa Bearer assinado com outro segredo', async () => {
    const token = await jwtService.signAsync(
      { sessionId: 'sess-1' },
      { secret: 'segredo-de-outro-servico' },
    );
    const { context } = createContext({
      request: { headers: { authorization: `Bearer ${token}` } },
    });

    const error = await catchBusinessError(guard.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(sessionService.read).not.toHaveBeenCalled();
  });

  it('recusa Bearer cuja sessão já foi revogada', async () => {
    sessionService.read.mockResolvedValue(null);
    const token = await jwtService.signAsync(
      { sessionId: 'sess-1' },
      { secret: JWT_SECRET },
    );
    const { context } = createContext({
      request: { headers: { authorization: `Bearer ${token}` } },
    });

    const error = await catchBusinessError(guard.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('SESSION_EXPIRED');
  });

  it('dá precedência ao cookie sobre o Bearer', async () => {
    sessionService.read.mockResolvedValue(SESSION);
    const token = await jwtService.signAsync(
      { sessionId: 'sess-do-bearer' },
      { secret: 'segredo-de-outro-servico' },
    );
    const { context, request } = createContext({
      request: {
        cookies: { [SESSION_COOKIE_NAME]: 'sess-1' },
        headers: { authorization: `Bearer ${token}` },
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionService.read).toHaveBeenCalledWith('sess-1');
    expect(request.user).toEqual(SESSION);
  });

  it('recusa Bearer quando o serviço de JWT não está disponível', async () => {
    const semJwt = new JwtAuthGuard(
      new Reflector(),
      sessionService as unknown as SessionService,
    );
    const { context } = createContext({
      request: { headers: { authorization: 'Bearer qualquer-coisa' } },
    });

    const error = await catchBusinessError(semJwt.canActivate(context));

    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });
});

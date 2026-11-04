import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../errors/business.exception.js';
import type { AuthUser, AuthenticatedRequest } from './auth.types.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const VENDEDOR: AuthUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'sess-1',
  role: 'USUARIO',
  operationalRole: 'VENDEDOR',
};

class RotaSemRoles {
  handler(): void {}
}

class RotaDeAdmin {
  @Roles('ADMIN')
  handler(): void {}
}

@Roles('ADMIN', 'CAPTADOR')
class RotaDeAdminOuCaptador {
  handler(): void {}
}

interface ContextOptions {
  handler?: () => void;
  cls?: new () => unknown;
  user?: AuthUser;
}

function createContext(options: ContextOptions = {}): ExecutionContext {
  const request = { user: options.user } as AuthenticatedRequest;

  return {
    getHandler: () => options.handler ?? RotaSemRoles.prototype.handler,
    getClass: () => options.cls ?? RotaSemRoles,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;

  beforeEach(() => {
    guard = new RolesGuard(new Reflector());
  });

  it('libera rota sem metadado @Roles', () => {
    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('libera quando o papel operacional está entre os permitidos', () => {
    expect(
      guard.canActivate(
        createContext({
          handler: RotaDeAdmin.prototype.handler,
          cls: RotaDeAdmin,
          user: { ...VENDEDOR, operationalRole: 'ADMIN' },
        }),
      ),
    ).toBe(true);
  });

  it('libera rota de controller inteiro quando o papel está na lista', () => {
    expect(
      guard.canActivate(
        createContext({
          handler: RotaDeAdminOuCaptador.prototype.handler,
          cls: RotaDeAdminOuCaptador,
          user: { ...VENDEDOR, operationalRole: 'CAPTADOR' },
        }),
      ),
    ).toBe(true);
  });

  it('bloqueia com 403 FORBIDDEN quando o papel não é permitido @spec:AC-047', () => {
    let capturado: unknown;

    try {
      guard.canActivate(
        createContext({
          handler: RotaDeAdmin.prototype.handler,
          cls: RotaDeAdmin,
          user: VENDEDOR,
        }),
      );
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(BusinessException);
    const business = capturado as BusinessException;
    expect(business.getStatus()).toBe(403);
    expect(business.code).toBe('FORBIDDEN');
  });

  it('bloqueia com 403 quando a rota exige papel e não há request.user', () => {
    let capturado: unknown;

    try {
      guard.canActivate(
        createContext({
          handler: RotaDeAdmin.prototype.handler,
          cls: RotaDeAdmin,
        }),
      );
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(BusinessException);
    expect((capturado as BusinessException).getStatus()).toBe(403);
    expect((capturado as BusinessException).code).toBe('FORBIDDEN');
  });

  it('considera o eixo role (corpus) separado do operacional', () => {
    // `role: ADMIN` não substitui `operationalRole`: quem exige ADMIN no eixo
    // operacional não pode ser liberado pelo papel de corpus.
    expect(() =>
      guard.canActivate(
        createContext({
          handler: RotaDeAdmin.prototype.handler,
          cls: RotaDeAdmin,
          user: { ...VENDEDOR, role: 'ADMIN' },
        }),
      ),
    ).toThrow(BusinessException);
  });
});

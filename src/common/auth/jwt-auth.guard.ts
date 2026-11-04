import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BusinessException } from '../errors/business.exception.js';
import { env } from '../../config/env.js';
import type { AuthUser, AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { SESSION_COOKIE_NAME, SessionService } from './session.service.js';

/** Payload esperado do JWT: identificadores e papéis, nada sensível. */
interface SessionTokenPayload {
  sessionId?: unknown;
}

/** Extrai o cookie de sessão (cookie-parser já rodou na requisição). */
function readSessionCookie(request: AuthenticatedRequest): string | undefined {
  const value: unknown = request.cookies?.[SESSION_COOKIE_NAME];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Extrai o token de `Authorization: Bearer <token>`, quando houver. */
function readBearerToken(request: AuthenticatedRequest): string | undefined {
  const header = request.headers.authorization;

  if (typeof header !== 'string') {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  return match?.[1];
}

/**
 * Guard global de autenticação.
 *
 * Aceita o cookie `np_session` (fluxo do browser) ou um Bearer token. O cookie
 * tem precedência: é ele que o frontend usa e é ele que o logout apaga.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
    /**
     * Opcional porque o `JwtModule` é registrado no módulo de autenticação: sem
     * ele o app ainda sobe e o fluxo por cookie (o do produto) continua válido.
     */
    @Optional() private readonly jwtService?: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const cookieSessionId = readSessionCookie(request);

    if (cookieSessionId) {
      request.user = await this.requireSession(cookieSessionId);
      return true;
    }

    const token = readBearerToken(request);

    if (token) {
      request.user = await this.resolveBearer(token);
      return true;
    }

    throw new BusinessException(
      401,
      'UNAUTHORIZED',
      'Autenticação necessária.',
    );
  }

  private async requireSession(sessionId: string): Promise<AuthUser> {
    const authUser = await this.sessionService.read(sessionId);

    if (!authUser) {
      throw new BusinessException(
        401,
        'SESSION_EXPIRED',
        'Sessão expirada ou inexistente.',
      );
    }

    return authUser;
  }

  private async resolveBearer(token: string): Promise<AuthUser> {
    if (!this.jwtService) {
      throw new BusinessException(
        401,
        'UNAUTHORIZED',
        'Autenticação necessária.',
      );
    }

    let payload: SessionTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<SessionTokenPayload>(token, {
        secret: env().JWT_SECRET,
      });
    } catch {
      throw new BusinessException(
        401,
        'UNAUTHORIZED',
        'Token inválido ou expirado.',
      );
    }

    const sessionId =
      typeof payload.sessionId === 'string' ? payload.sessionId : undefined;

    // A sessão no Redis é a fonte de verdade: um JWT só vale enquanto a sessão
    // existir. Token sem `sessionId` (forjado, emitido por outro serviço ou
    // antigo) não pode ser aceito — sem sessão não há como revogá-lo no
    // logout, no bloqueio do usuário nem na troca de senha.
    if (!sessionId) {
      throw new BusinessException(
        401,
        'SESSION_EXPIRED',
        'Sessão expirada ou inexistente.',
      );
    }

    return this.requireSession(sessionId);
  }
}

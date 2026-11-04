import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../errors/business.exception.js';
import type { AuthUser, AuthenticatedRequest } from './auth.types.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Guard global de autorização por papel operacional.
 *
 * Roda depois do `JwtAuthGuard` (que popula `request.user`) e só barra rotas
 * que declaram `@Roles(...)`. Sem metadado, a rota é liberada para qualquer
 * usuário autenticado — o padrão não é negar tudo.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      AuthUser['operationalRole'][] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.operationalRole)) {
      throw new BusinessException(
        403,
        'FORBIDDEN',
        'Seu perfil não tem permissão para esta ação.',
      );
    }

    return true;
  }
}

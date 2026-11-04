import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthenticatedRequest } from './auth.types.js';

/**
 * Injeta o usuário autenticado (ou um de seus campos).
 *
 * `@CurrentUser() user: AuthUser` no controller evita que cada módulo repita
 * a leitura de `request.user` — e mantém o acesso ao tenant no mesmo ponto.
 */
export const CurrentUser = createParamDecorator(
  (
    field: keyof AuthUser | undefined,
    context: ExecutionContext,
  ): AuthUser | AuthUser[keyof AuthUser] | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return field ? user[field] : user;
  },
);

/**
 * Atalho para o `tenantId` da sessão.
 *
 * Toda query que toca `TenantLead`, `User`, `Stage` ou `LeadTimelineNote` é
 * filtrada por ele — nunca pelo tenant enviado no corpo da requisição.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user?.tenantId;
  },
);

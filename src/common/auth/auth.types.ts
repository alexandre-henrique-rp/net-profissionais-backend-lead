import type { Request } from 'express';

/** Papel de permissão de corpus (`UserRole` do Prisma). */
export type AuthRole = 'ADMIN' | 'USUARIO';

/** Papel operacional, que define dashboard e navegação (`OperationalRole`). */
export type AuthOperationalRole = 'ADMIN' | 'CAPTADOR' | 'VENDEDOR';

/**
 * Usuário autenticado anexado ao `request`.
 *
 * É o que fica gravado na sessão do Redis e o que os guards populam — por isso
 * vive na camada `common`: controllers, services e guards de todos os módulos
 * dependem desta forma.
 */
export interface AuthUser {
  userId: string;
  tenantId: string;
  sessionId: string;
  role: AuthRole;
  operationalRole: AuthOperationalRole;
}

/** Request HTTP já com o usuário resolvido pelo `JwtAuthGuard`. */
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

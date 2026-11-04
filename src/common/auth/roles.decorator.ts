import { SetMetadata } from '@nestjs/common';
import type { AuthUser } from './auth.types.js';

/** Chave do metadado lido pelo `RolesGuard`. */
export const ROLES_KEY = 'roles';

/**
 * Restringe a rota por papel operacional — o eixo que define dashboard e
 * navegação (Administrador, Captador, Vendedor).
 *
 * Uso: `@Roles('ADMIN')`. Sem o decorator, o `RolesGuard` libera a rota para
 * qualquer usuário autenticado.
 */
export const Roles = (...roles: AuthUser['operationalRole'][]) =>
  SetMetadata(ROLES_KEY, roles);

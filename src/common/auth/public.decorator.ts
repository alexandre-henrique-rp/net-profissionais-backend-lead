import { SetMetadata } from '@nestjs/common';

/** Chave do metadado lido pelo `JwtAuthGuard`. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Libera a rota (ou o controller inteiro) da autenticação.
 *
 * Login, recuperação de senha, ativação de conta, webhook público e health
 * precisam existir antes de haver sessão — sem marcar, o guard global
 * responderia 401.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

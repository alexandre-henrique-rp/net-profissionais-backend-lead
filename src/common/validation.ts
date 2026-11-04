import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * Opções do `ValidationPipe` global.
 *
 * Fica num módulo próprio porque `main.ts` (aplicação real) e os testes
 * e2e precisam do mesmo comportamento — e o critério de aceite exige que os
 * dois usem exatamente a mesma configuração.
 */
export const validationPipeOptions: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
};

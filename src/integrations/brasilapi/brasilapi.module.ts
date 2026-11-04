import { Module } from '@nestjs/common';
import { BrasilApiController } from './brasilapi.controller.js';
import { BrasilApiService } from './brasilapi.service.js';

/**
 * Integração com a BrasilAPI (consulta de CNPJ).
 *
 * `RedisService` vem do `RedisModule`, que é global — por isso não entra em
 * `imports`.
 */
@Module({
  controllers: [BrasilApiController],
  providers: [BrasilApiService],
  exports: [BrasilApiService],
})
export class BrasilApiModule {}

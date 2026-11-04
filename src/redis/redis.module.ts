import { Global, Module } from '@nestjs/common';
import { createRedisClient, REDIS_CLIENT, RedisService } from './redis.service.js';

/**
 * Módulo global do Redis — `RedisService` fica disponível em qualquer módulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => createRedisClient(),
    },
    RedisService,
  ],
  // `REDIS_CLIENT` também é exportado: o `SessionService` precisa do cliente
  // cru para manter o índice `sess:user:<id>` (SET) e encerrar as sessões de
  // um usuário bloqueado.
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}

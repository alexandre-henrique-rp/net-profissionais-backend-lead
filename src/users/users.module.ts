import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Módulo de gestão de colaboradores.
 *
 * `PrismaModule`, `RedisModule`, `MailModule` e `AuthModule` são globais, então
 * o `UsersService` recebe `PrismaService`, `SessionService` e `MailService`
 * sem import explícito.
 */
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

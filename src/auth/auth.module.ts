import { Global, Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { SessionService } from '../common/auth/session.service.js';
import { env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * Módulo de autenticação.
 *
 * `@Global()` é obrigatório: o `JwtAuthGuard` global do `AppModule` resolve
 * `SessionService` e `JwtService` por aqui, e os módulos de negócio (users,
 * leads, pipeline) injetam `SessionService` para revogar acesso sem importar
 * este módulo.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      // `global: true` deixa o `JwtService` disponível para o guard.
      global: true,
      useFactory: () => ({
        secret: env().JWT_SECRET,
        signOptions: {
          // O valor vem do ambiente no formato do `jsonwebtoken` (`8h`).
          expiresIn: env().JWT_EXPIRES_IN as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService, SessionService, JwtModule],
})
export class AuthModule {}

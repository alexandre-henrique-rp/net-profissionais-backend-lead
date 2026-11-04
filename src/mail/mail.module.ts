import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * Módulo global de e-mail.
 *
 * `@Global()` porque convite (módulo `users`) e recuperação de senha (módulo
 * `auth`) usam o mesmo serviço e não devem repetir o import.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}

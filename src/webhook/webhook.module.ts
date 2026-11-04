import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';

/**
 * Captura passiva de leads por webhook (integrações externas).
 *
 * A rota é pública (`@Public()` no controller): quem chama é a landing page ou
 * a plataforma de anúncios, autenticada pelo HMAC do `webhookToken` da
 * corporação — não há sessão para validar. `PrismaService` e `REDIS_CLIENT`
 * vêm dos módulos globais.
 */
@Module({
  controllers: [WebhookController],
  providers: [WebhookService, WebhookSignatureGuard],
  exports: [WebhookService],
})
export class WebhookModule {}

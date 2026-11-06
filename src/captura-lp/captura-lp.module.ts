import { Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { CapturaLpController } from './captura-lp.controller.js';
import { LimiteDeOrigemService } from './limite-origem.service.js';
import {
  CAPTURA_CONFIG,
  CAPTURA_FETCH,
  CAPTURA_RELOGIO,
  type CapturaFetch,
  type ConfiguracaoCaptura,
} from './webhook-relay.service.js';
import { WebhookRelayService } from './webhook-relay.service.js';

/**
 * Módulo do relé de captação da landing page.
 *
 * Ele **não** cria caminho de entrada de lead novo: o webhook continua sendo
 * o único. O que existe aqui é a ponte entre a página estática (que não pode
 * carregar segredo) e o webhook (que exige assinatura HMAC).
 */
@Module({
  controllers: [CapturaLpController],
  providers: [
    WebhookRelayService,
    LimiteDeOrigemService,
    {
      // A configuração vem do ambiente; `env.ts` é o único lugar do backend
      // que lê as variáveis de ambiente.
      provide: CAPTURA_CONFIG,
      useFactory: (): ConfiguracaoCaptura => {
        const configuracao = env();

        return {
          token: configuracao.WEBHOOK_TOKEN,
          tenantId: configuracao.WEBHOOK_TENANT_ID,
          apiBase:
            configuracao.WEBHOOK_API_BASE ??
            `http://127.0.0.1:${configuracao.PORT}/api/v1`,
        };
      },
    },
    {
      // Transporte das entregas: `fetch` nativo do Node. É o único ponto do
      // módulo que fala HTTP com a fora.
      provide: CAPTURA_FETCH,
      useFactory: (): CapturaFetch =>
        (url, init) => fetch(url, init) as unknown as Promise<never>,
    },
    {
      // Relógio do módulo: injetável para o teste avançar o tempo.
      provide: CAPTURA_RELOGIO,
      useFactory: (): (() => number) => () => Date.now(),
    },
  ],
})
export class CapturaLpModule {}

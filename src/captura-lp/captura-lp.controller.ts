import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Public } from '../common/auth/public.decorator.js';
import { BusinessException } from '../common/errors/business.exception.js';
import type { WebhookLeadPayloadDto } from '../webhook/dto/webhook-payload.dto.js';
import { LimiteDeOrigemService } from './limite-origem.service.js';
import { WebhookRelayService } from './webhook-relay.service.js';

/** Versão da API repetida no envelope (mesma do `ApiResponseInterceptor`). */
const API_VERSION = 'v1';

/**
 * Origem da requisição, para o limite por origem.
 *
 * A landing page fica em outro site (`site.kingdevtec.com`) e o pedido passa
 * pelo túnel da Cloudflare: o endereço real do visitante chega no
 * `CF-Connecting-IP`. Os outros cabeçalhos são o plano B, e `req.ip` é o
 * último recurso — sem proxy configurado, ele é o endereço do túnel.
 */
export function origemDaRequisicao(request: Request): string {
  const cloudflare = request.headers['cf-connecting-ip'];

  if (typeof cloudflare === 'string' && cloudflare.trim() !== '') {
    return cloudflare.trim();
  }

  const encaminhados = request.headers['x-forwarded-for'];

  if (typeof encaminhados === 'string' && encaminhados.trim() !== '') {
    const primeiro = encaminhados.split(',')[0]?.trim();

    if (primeiro) return primeiro;
  }

  return request.ip ?? 'desconhecida';
}

/**
 * Relé público de captação da landing page.
 *
 * A rota é `@Public()`: quem chama é o navegador do visitante, sem sessão e
 * sem token de usuário. A credencial é a assinatura HMAC que o próprio
 * servidor calcula antes de encaminhar — o segredo nunca sai daqui.
 *
 * O corpo é o contrato do webhook (`doc/06`), o mesmo DTO que a rota
 * `/webhooks/leads/:tenantId` valida: assim a landing page e o webhook
 * falam a mesma língua, sem tradução no meio do caminho.
 */
@ApiTags('captura')
@Controller('captura')
export class CapturaLpController {
  constructor(
    private readonly relay: WebhookRelayService,
    private readonly limite: LimiteDeOrigemService,
  ) {}

  @Public()
  @Post('leads')
  @ApiOperation({
    summary: 'Recebe um lead de landing page externa e encaminha para o webhook',
    description:
      'Rota pública: sem cookie e sem `Authorization`. O corpo é o contrato do webhook de captura (`lead`, `lgpd_consent`, `source`, `metadata`). O servidor assina o corpo com o token do ambiente e encaminha para o webhook — o segredo nunca chega ao navegador. Exige `lgpd_consent: true`. `Idempotency-Key` evita lead duplicado quando o visitante clica duas vezes.',
  })
  @ApiResponse({ status: 201, description: 'Lead novo entregue ao webhook.' })
  @ApiResponse({ status: 200, description: 'Reenvio idempotente (`duplicate: true`).' })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — documento ou contato inválido.' })
  @ApiResponse({ status: 422, description: '`LGPD_CONSENT_REQUIRED`.' })
  @ApiResponse({ status: 429, description: 'Excesso de entregas da mesma origem.' })
  @ApiResponse({ status: 502, description: '`WEBHOOK_INDISPONIVEL` — o webhook não respondeu.' })
  async receber(
    @Body() payload: WebhookLeadPayloadDto,
    @Headers('idempotency-key') chaveDeIdempotencia: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.limite.permitir(origemDaRequisicao(request))) {
      throw new BusinessException(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMIT_EXCEEDED',
        'Muitas tentativas. Tente em alguns minutos.',
      );
    }

    const chave = chaveDeIdempotencia?.trim() || randomUUID();
    const resultado = await this.relay.encaminhar(payload, chave);

    response.status(resultado.status).json({
      success: true,
      data: resultado.dados,
      meta: { timestamp: new Date().toISOString(), version: API_VERSION },
    });
  }
}

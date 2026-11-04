import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { SuccessEnvelope } from '../common/http/api-response.interceptor.js';
import { Public } from '../common/auth/public.decorator.js';
import { WebhookLeadPayloadDto } from './dto/webhook-payload.dto.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { extractRawBody } from './webhook.signature.js';
import { WebhookService, type WebhookLeadResult } from './webhook.service.js';

/** Versão da API repetida no envelope (`ApiResponseInterceptor`). */
const API_VERSION = 'v1';

/**
 * Monta o envelope de sucesso que o `ApiResponseInterceptor` produziria.
 *
 * Só esta rota precisa disso: ela responde **201** no lead novo e **200** no
 * reenvio idempotente, e o Nest aplica um status fixo depois do handler —
 * `@HttpCode` (ou o 201 padrão do POST) sobrepõe `res.status()`. Com `@Res()`
 * a resposta é escrita aqui, com status dinâmico e o mesmo formato global.
 */
function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return {
    success: true,
    data,
    meta: { timestamp: new Date().toISOString(), version: API_VERSION },
  };
}

/**
 * Webhook público de captura passiva de leads.
 *
 * **Corpo bruto (raw body):** a assinatura é `HMAC-SHA256(corpo bruto,
 * webhookToken)`, então o parser precisa entregar os bytes originais. O app é
 * criado com `NestFactory.create(AppModule, { rawBody: true })`, que expõe
 * `req.rawBody` sem desligar o parser JSON global. Sem esse `rawBody`,
 * `extractRawBody()` cai para `JSON.stringify(req.body)` — reordenação de
 * chaves ou espaços no corpo enviado fazem a assinatura não conferir.
 *
 * O `WebhookSignatureGuard` roda antes dos pipes: assinatura errada responde
 * 401 mesmo se o corpo também estiver inválido.
 */
@ApiTags('webhook')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhook: WebhookService) {}

  @Public()
  @UseGuards(WebhookSignatureGuard)
  @Post('leads/:tenantId')
  @ApiOperation({
    summary: 'Recebe um lead de canal externo (landing page, Ads, indicação)',
    description:
      'Autenticado por HMAC-SHA256 (`X-Signature` sobre o corpo bruto + `X-Timestamp` com tolerância de 5 min). Exige `lgpd_consent: true`. `Idempotency-Key` opcional evita duplicata por 24h. O lead entra no Pool na primeira etapa do funil.',
  })
  @ApiParam({ name: 'tenantId', description: 'Id da corporação dona do webhook.' })
  @ApiResponse({ status: 201, description: 'Lead captado e disponibilizado no Pool.' })
  @ApiResponse({ status: 200, description: 'Reenvio idempotente (`duplicate: true`).' })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — payload ou documento inválido.' })
  @ApiResponse({ status: 401, description: '`INVALID_SIGNATURE` — assinatura/timestamp inválido.' })
  @ApiResponse({ status: 404, description: '`NOT_FOUND` — corporação inexistente.' })
  @ApiResponse({ status: 422, description: '`LGPD_CONSENT_REQUIRED`.' })
  async receive(
    @Param('tenantId') tenantId: string,
    @Body() payload: WebhookLeadPayloadDto,
    @Req() request: RawBodyRequest<Request>,
    @Res() response: Response,
    @Headers('x-signature') signature?: string,
    @Headers('x-timestamp') timestamp?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<void> {
    const result: WebhookLeadResult = await this.webhook.ingest({
      tenantId,
      payload,
      rawBody: extractRawBody(request),
      signature,
      timestamp,
      idempotencyKey,
    });

    response
      .status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED)
      .json(successEnvelope(result));
  }
}

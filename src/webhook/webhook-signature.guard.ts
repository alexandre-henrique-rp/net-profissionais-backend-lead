import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { BusinessException } from '../common/errors/business.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UUID_PATTERN, WEBHOOK_ERROR_CODES } from './webhook.constants.js';
import { assertSignatureIsValid, extractRawBody } from './webhook.signature.js';

/** Headers lidos do integrador (case-insensitive no HTTP, lower no Express). */
const SIGNATURE_HEADER = 'x-signature';
const TIMESTAMP_HEADER = 'x-timestamp';

function readHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];

  return typeof value === 'string' ? value : undefined;
}

/**
 * Autentica o webhook público antes de qualquer validação de corpo.
 *
 * A rota é `@Public()` (não há sessão: quem chama é o integrador), então a
 * autenticação é o HMAC do corpo bruto com o `webhookToken` da corporação. O
 * guard roda antes dos pipes: um payload malformado com assinatura errada
 * responde 401, nunca 400 — o cliente precisa saber que o problema é a chave.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const tenantId = String(request.params?.tenantId ?? '');

    if (!UUID_PATTERN.test(tenantId)) {
      throw new BusinessException(
        404,
        WEBHOOK_ERROR_CODES.notFound,
        'Corporação não encontrada.',
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { webhookToken: true },
    });

    if (!tenant) {
      throw new BusinessException(
        404,
        WEBHOOK_ERROR_CODES.notFound,
        'Corporação não encontrada.',
      );
    }

    assertSignatureIsValid({
      rawBody: extractRawBody(request),
      secret: tenant.webhookToken,
      signature: readHeader(request, SIGNATURE_HEADER),
      timestamp: readHeader(request, TIMESTAMP_HEADER),
    });

    return true;
  }
}

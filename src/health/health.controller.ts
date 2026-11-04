import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/public.decorator.js';
import { SkipEnvelope } from '../common/http/skip-envelope.decorator.js';

/**
 * Sonda de saúde da API.
 *
 * Não toca em banco nem em Redis de propósito: serve para o orquestrador
 * saber que o processo subiu (doc/mvp/specs/task-s01-01.md).
 *
 * `@Public()` porque o healthcheck chega sem sessão — sem ele o guard global
 * responderia 401 e o deploy nunca ficaria saudável. `@SkipEnvelope()` porque
 * o critério `AC-001` exige o corpo exatamente `{"status":"ok"}`.
 */
@ApiTags('health')
@Public()
@SkipEnvelope()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Sonda de saúde da API' })
  @ApiResponse({
    status: 200,
    description: 'A API está no ar.',
    schema: { example: { status: 'ok' } },
  })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

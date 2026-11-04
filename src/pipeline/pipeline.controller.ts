import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { CommercialTermsDto } from './dto/commercial-terms.dto.js';
import { MarkAsLostDto } from './dto/mark-as-lost.dto.js';
import { MoveStageDto } from './dto/move-stage.dto.js';
import { PipelineQueryDto } from './dto/pipeline-query.dto.js';
import { PipelineService } from './pipeline.service.js';

/**
 * Funil de Vendas — Kanban `04-A`, Lista `04-B` e os dois overlays de card
 * (`04-C-D`/`04-C-L`).
 *
 * Divide o prefixo `/leads` com o módulo do Pool de propósito: o Pool cuida de
 * `/leads/manual` e `/leads/pool*`; aqui ficam apenas as rotas do funil.
 */
@ApiTags('pipeline')
@ApiCookieAuth('np_session')
@Controller('leads')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Get('pipeline')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Funil de vendas agrupado por etapa',
    description:
      'Devolve as etapas do tenant (ordenadas por `position`) com os cards, o contador e o somatório de ticket de cada coluna. Vendedor só enxerga a própria carteira.',
  })
  @ApiResponse({ status: 200, description: 'Funil montado (colunas vazias são válidas).' })
  @ApiResponse({ status: 400, description: 'Filtro inválido (ex.: `assigned_user_id` que não é UUID).' })
  async getPipeline(
    @CurrentUser() user: AuthUser,
    @Query() query: PipelineQueryDto,
  ) {
    return this.pipelineService.getPipeline(user, query);
  }

  @Patch(':id/stage')
  @Roles('ADMIN', 'VENDEDOR')
  @ApiOperation({
    summary: 'Move o card para outra etapa do funil',
    description:
      'Lock otimista por `version`. Mover para a etapa de perda exige `loss_reason_code`. Gera nota na timeline e evento no barramento do funil.',
  })
  @ApiResponse({
    status: 200,
    description: 'Card atualizado no mesmo shape de `GET /leads/pipeline` (com `ticket_value` numérico).',
  })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — card de outro vendedor.' })
  @ApiResponse({ status: 404, description: '`LEAD_NOT_FOUND`.' })
  @ApiResponse({ status: 409, description: '`VERSION_CONFLICT`.' })
  @ApiResponse({
    status: 422,
    description: '`LOSS_REASON_REQUIRED` ou `INVALID_STAGE_TRANSITION`.',
  })
  async moveStage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveStageDto,
  ) {
    return this.pipelineService.moveStage(user, id, dto);
  }

  @Put(':id/commercial-terms')
  @Roles('ADMIN', 'VENDEDOR')
  @ApiOperation({
    summary: 'Atualiza os termos comerciais do card',
    description:
      'Ticket, probabilidade, previsão de fechamento e escopo da proposta (Modal 1 de Overlays).',
  })
  @ApiResponse({
    status: 200,
    description: 'Card atualizado no mesmo shape de `GET /leads/pipeline` (com `ticket_value` numérico).',
  })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — valor negativo ou data no passado.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — card de outro vendedor.' })
  @ApiResponse({ status: 404, description: '`LEAD_NOT_FOUND`.' })
  @ApiResponse({ status: 409, description: '`VERSION_CONFLICT`.' })
  async updateCommercialTerms(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CommercialTermsDto,
  ) {
    return this.pipelineService.updateCommercialTerms(user, id, dto);
  }

  @Post(':id/mark-as-lost')
  @Roles('ADMIN', 'VENDEDOR')
  @ApiOperation({
    summary: 'Marca o card como perdido',
    description:
      'Move para a etapa de perda, grava o motivo (uma das 6 causas parametrizadas) e registra a auditoria na timeline (Modal 2 de Overlays).',
  })
  @ApiResponse({ status: 200, description: 'Card marcado como perdido.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — card de outro vendedor.' })
  @ApiResponse({ status: 404, description: '`LEAD_NOT_FOUND`.' })
  @ApiResponse({ status: 409, description: '`VERSION_CONFLICT`.' })
  @ApiResponse({ status: 422, description: '`LOSS_REASON_REQUIRED` — motivo ausente ou fora da lista.' })
  async markAsLost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MarkAsLostDto,
  ) {
    return this.pipelineService.markAsLost(user, id, dto);
  }
}

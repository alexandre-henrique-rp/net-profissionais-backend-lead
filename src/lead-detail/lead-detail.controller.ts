import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { CreateTimelineNoteDto } from './dto/create-timeline-note.dto.js';
import { UnlinkLeadDto } from './dto/unlink-lead.dto.js';
import type { LeadDetailResponse, TimelineNoteResponse } from './lead-detail.mapper.js';
import { LeadDetailService } from './lead-detail.service.js';

/**
 * Ficha completa do lead — gaveta lateral `Drawer 01` do Penpot.
 *
 * Divide o prefixo `/leads` com os módulos de Pool (`/leads/pool*`,
 * `/leads/manual`) e do funil (`/leads/pipeline`, `/leads/:id/stage`). A rota
 * `GET /leads/:id` é a mais genérica do prefixo: **o `LeadDetailModule` precisa
 * ser registrado depois de `LeadsModule` e `PipelineModule` no `AppModule`**,
 * senão `/leads/pool` e `/leads/pipeline` seriam capturadas por `:id`.
 */
@ApiTags('lead-detail')
@ApiCookieAuth('np_session')
@Controller('leads')
export class LeadDetailController {
  constructor(private readonly leadDetail: LeadDetailService) {}

  @Get(':id')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Ficha completa do lead (3 abas da gaveta)',
    description:
      'Linha do tempo (100 notas mais recentes), contatos com link de WhatsApp Web e dados fiscais da Receita. `:id` é o id do `TenantLead`.',
  })
  @ApiParam({ name: 'id', description: 'Id do `TenantLead` (a oportunidade na corporação).' })
  @ApiResponse({ status: 200, description: 'Ficha do lead com as 3 abas.' })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — lead de outro vendedor.' })
  @ApiResponse({ status: 404, description: '`LEAD_NOT_FOUND`.' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<LeadDetailResponse> {
    return this.leadDetail.getDetail(id, user);
  }

  @Post(':id/timeline-notes')
  @HttpCode(201)
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Registra uma nota/interação na linha do tempo',
    description:
      'Grava a nota e atualiza `lastContactAt` na mesma transação — é o que zera o alerta de lead parado há mais de 48h.',
  })
  @ApiParam({ name: 'id', description: 'Id do `TenantLead`.' })
  @ApiResponse({ status: 201, description: 'Nota criada.' })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — corpo inválido.' })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — lead de outro vendedor.' })
  @ApiResponse({ status: 404, description: '`LEAD_NOT_FOUND`.' })
  async createTimelineNote(
    @Param('id') id: string,
    @Body() dto: CreateTimelineNoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TimelineNoteResponse> {
    return this.leadDetail.createTimelineNote(id, user, dto);
  }

  @Post(':id/unlink')
  @HttpCode(200)
  @Roles('ADMIN', 'VENDEDOR')
  @ApiOperation({
    summary: 'Desvincula o lead e o devolve ao Pool',
    description:
      'Volta o card para `RETURNED_TO_POOL`, limpa o responsável, incrementa `version` e registra a devolução na linha do tempo.',
  })
  @ApiParam({ name: 'id', description: 'Id do `TenantLead`.' })
  @ApiResponse({ status: 200, description: 'Lead devolvido ao Pool (ficha atualizada).' })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — não é o responsável nem Administrador.' })
  @ApiResponse({ status: 404, description: '`LEAD_NOT_FOUND`.' })
  async unlink(
    @Param('id') id: string,
    @Body() dto: UnlinkLeadDto,
    @CurrentUser() user: AuthUser,
  ): Promise<LeadDetailResponse> {
    return this.leadDetail.unlink(id, user, dto);
  }
}

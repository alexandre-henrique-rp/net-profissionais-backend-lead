import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentTenant } from '../common/auth/current-user.decorator.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { ClaimPoolLeadDto } from './dto/claim-pool-lead.dto.js';
import { CreateManualLeadDto } from './dto/create-manual-lead.dto.js';
import { PoolQueryDto } from './dto/pool-query.dto.js';
import type { TenantLeadResponse } from './leads.mapper.js';
import { LeadsService, type PoolResponse } from './leads.service.js';

/**
 * Pool de leads e cadastro híbrido (`03-D`, `03-C-D` e `03-B-D`).
 *
 * O `tenantId` sai sempre de `@CurrentTenant()` — nenhuma rota aceita tenant
 * no corpo ou na query.
 */
@ApiTags('leads')
@ApiCookieAuth('np_session')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post('manual')
  @HttpCode(201)
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Cadastra um lead manualmente (PJ ou PF) e o envia ao Pool',
  })
  @ApiResponse({
    status: 201,
    description: 'Lead criado e disponibilizado no Pool.',
  })
  @ApiResponse({
    status: 400,
    description: 'Corpo inválido (documento ausente ou malformado).',
  })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  @ApiResponse({
    status: 409,
    description: 'O lead já existe na carteira desta corporação.',
  })
  @ApiResponse({
    status: 422,
    description: 'A corporação não possui etapas configuradas.',
  })
  async createManual(
    @Body() dto: CreateManualLeadDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TenantLeadResponse> {
    return this.leads.createManual(dto, tenantId, user.userId);
  }

  @Get('pool')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Lista os leads disponíveis no Pool com filtros e paginação',
  })
  @ApiResponse({ status: 200, description: 'Página de leads do Pool.' })
  @ApiResponse({ status: 400, description: 'Paginação inválida.' })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  async findPool(
    @Query() query: PoolQueryDto,
    @CurrentTenant() tenantId: string,
  ): Promise<PoolResponse> {
    return this.leads.findPool(query, tenantId);
  }

  @Post('pool/:id/claim')
  @HttpCode(200)
  @Roles('ADMIN', 'VENDEDOR')
  @ApiOperation({
    summary: 'Assume um lead do Pool para o usuário autenticado',
  })
  @ApiParam({
    name: 'id',
    description: 'Id do `TenantLead` (a oportunidade no Pool).',
  })
  @ApiBody({ type: ClaimPoolLeadDto, required: false })
  @ApiResponse({
    status: 200,
    description: 'Lead captado e atribuído ao usuário.',
  })
  @ApiResponse({ status: 401, description: 'Sessão ausente ou expirada.' })
  @ApiResponse({
    status: 403,
    description: 'Captadores não podem assumir leads do Pool.',
  })
  @ApiResponse({
    status: 404,
    description: 'Lead não encontrado no Pool desta corporação.',
  })
  @ApiResponse({
    status: 409,
    description: 'Lead já assumido ou versão divergente.',
  })
  @ApiResponse({
    status: 422,
    description: 'Cota diária de captações atingida.',
  })
  async claim(
    @Param('id') id: string,
    @Body() dto: ClaimPoolLeadDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TenantLeadResponse> {
    return this.leads.claim(id, tenantId, user, dto);
  }
}

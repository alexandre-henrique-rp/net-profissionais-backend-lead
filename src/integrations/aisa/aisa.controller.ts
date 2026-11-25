import { Body, Controller, Get, HttpCode, Put, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth.types.js';
import {
  CurrentTenant,
  CurrentUser,
} from '../../common/auth/current-user.decorator.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { AisaService } from './aisa.service.js';
import type {
  AisaConfigResponse,
  AisaImportResponse,
  AisaSearchResponse,
} from './aisa.types.js';
import { ImportAisaLeadsDto } from './dto/import-aisa-leads.dto.js';
import { SearchAisaLeadsDto } from './dto/search-aisa-leads.dto.js';
import { UpdateAisaConfigDto } from './dto/update-aisa-config.dto.js';

/**
 * Prospecção B2B via API REST direta da Aisa (`https://api.aisa.one`).
 *
 * Mantém as credenciais cifradas por tenant no banco e expõe apenas máscaras
 * seguras ao frontend.
 */
@ApiTags('integrations')
@ApiCookieAuth('np_session')
@Controller('integrations/aisa')
export class AisaController {
  constructor(private readonly aisa: AisaService) {}

  @Get('config')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Carrega as configurações da Aisa e do provedor de IA do tenant',
  })
  @ApiResponse({ status: 200, description: 'Configuração atual mascarada.' })
  async getConfig(
    @CurrentTenant() tenantId: string,
  ): Promise<AisaConfigResponse> {
    return this.aisa.getConfig(tenantId);
  }

  @Put('config')
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Salva as credenciais da Aisa e do provedor de IA no banco',
  })
  @ApiResponse({ status: 200, description: 'Configuração atualizada.' })
  @ApiResponse({ status: 400, description: 'Dados ou URL inválidos.' })
  async updateConfig(
    @Body() dto: UpdateAisaConfigDto,
    @CurrentTenant() tenantId: string,
  ): Promise<AisaConfigResponse> {
    return this.aisa.updateConfig(tenantId, dto);
  }

  @Post('search')
  @HttpCode(200)
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Pesquisa empresas via API da Aisa e estrutura os leads com IA',
  })
  @ApiResponse({ status: 200, description: 'Candidatos encontrados.' })
  @ApiResponse({ status: 422, description: 'Chave Aisa não configurada.' })
  async searchLeads(
    @Body() dto: SearchAisaLeadsDto,
    @CurrentTenant() tenantId: string,
  ): Promise<AisaSearchResponse> {
    return this.aisa.searchLeads(tenantId, dto);
  }

  @Post('import')
  @HttpCode(201)
  @Roles('ADMIN', 'CAPTADOR', 'VENDEDOR')
  @ApiOperation({
    summary: 'Importa empresas selecionadas da busca Aisa para o Pool',
  })
  @ApiResponse({ status: 201, description: 'Leads importados para o Pool.' })
  async importLeads(
    @Body() dto: ImportAisaLeadsDto,
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AisaImportResponse> {
    return this.aisa.importLeads(tenantId, user.userId, dto);
  }
}

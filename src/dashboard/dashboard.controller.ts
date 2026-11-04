import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Roles } from '../common/auth/roles.decorator.js';
import { DashboardQueryDto } from './dto/dashboard-query.dto.js';
import { DashboardService } from './dashboard.service.js';
import type {
  AdminDashboardResponse,
  CaptadorDashboardResponse,
  SellerDashboardResponse,
} from './dashboard.types.js';

/**
 * Dashboards por perfil (`02-A-D`, `02-B-D` e `02-C-D`).
 *
 * O RBAC de dois eixos manda aqui: `@Roles` restringe pelo papel operacional
 * (quem enxerga qual tela) e o escopo de dados sai sempre da sessão — nunca
 * de um `user_id` na query.
 */
@ApiTags('dashboard')
@ApiCookieAuth('np_session')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('admin')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Dashboard do Administrador',
    description:
      'KPIs consolidados da corporação no período: funil por etapa, conversão, valor em pipeline, produtividade por vendedor e breakdown de motivos de perda. ' +
      '`conversion_rate` é **percentual** (0–100) de ganhos sobre o total de leads criados no período (`conversion_rate_basis = "won_over_total"`). ' +
      '`pipeline_total_value` soma apenas leads em aberto **e** atribuídos a um vendedor (Pool e negócios ganhos ficam de fora). ' +
      '`inactivity_alerts` conta apenas leads em carteira, em aberto e sem contato há mais de 48h.',
  })
  @ApiResponse({ status: 200, description: 'Consolidado corporativo do período.' })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — período inválido.' })
  @ApiResponse({ status: 401, description: '`UNAUTHORIZED` — sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — usuário não é administrador.' })
  async admin(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ): Promise<AdminDashboardResponse> {
    return this.dashboard.getAdminDashboard(user, query);
  }

  @Get('seller')
  @Roles('VENDEDOR', 'CAPTADOR')
  @ApiOperation({
    summary: 'Dashboard do Vendedor',
    description:
      'Rotina da carteira pessoal: funil próprio, conversão, tarefas do dia (previsão de fechamento e inatividade > 48h) e aniversariantes dos próximos 7 dias. ' +
      '`my_conversion_rate` é **percentual** (0–100) sobre o total da própria coorte (`my_conversion_rate_basis = "won_over_total"`). ' +
      'A lista `today_tasks` traz no máximo 20 itens; `today_tasks_total` é a quantidade real de pendências do dia. ' +
      '`today_tasks` e `birthdays` são listas de "agora" e não são recortadas por `period`.',
  })
  @ApiResponse({ status: 200, description: 'Métricas da carteira do usuário autenticado.' })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — período inválido.' })
  @ApiResponse({ status: 401, description: '`UNAUTHORIZED` — sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — administrador não tem carteira.' })
  async seller(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ): Promise<SellerDashboardResponse> {
    return this.dashboard.getSellerDashboard(user, query);
  }

  @Get('captador')
  @Roles('CAPTADOR', 'ADMIN')
  @ApiOperation({
    summary: 'Dashboard do Captador',
    description:
      'Desempenho da prospecção: total captado no período, distribuição por status, conversão dos leads trazidos e as 10 captações mais recentes. O captador vê apenas o que cadastrou; o administrador vê a corporação. ' +
      '`conversion_rate` é **percentual** (0–100) de ganhos sobre o total captado (`conversion_rate_basis = "won_over_total"`). ' +
      '`recent` é uma lista de "agora" e não é recortada por `period`.',
  })
  @ApiResponse({ status: 200, description: 'Métricas de captação do usuário (ou do tenant).' })
  @ApiResponse({ status: 400, description: '`VALIDATION_ERROR` — período inválido.' })
  @ApiResponse({ status: 401, description: '`UNAUTHORIZED` — sessão ausente ou expirada.' })
  @ApiResponse({ status: 403, description: '`FORBIDDEN` — vendedor não acessa esta tela.' })
  async captador(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDto,
  ): Promise<CaptadorDashboardResponse> {
    return this.dashboard.getCaptadorDashboard(user, query);
  }
}

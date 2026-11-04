import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { DASHBOARD_PERIODS, type DashboardPeriod } from '../period.js';

/**
 * Filtros temporais compartilhados por dashboards e exportações (§2.2).
 *
 * Fica numa classe base para que `GET /leads/export` use exatamente as mesmas
 * regras de `period`/`start_date`/`end_date` sem duplicar a validação.
 */
export class PeriodQueryDto {
  @ApiPropertyOptional({
    enum: DASHBOARD_PERIODS,
    default: 'this_month',
    description:
      'Janela de análise. `custom` exige `start_date` e `end_date` no formato ISO 8601.',
    example: 'last_quarter',
  })
  @IsOptional()
  @IsIn(DASHBOARD_PERIODS)
  period?: DashboardPeriod;

  @ApiPropertyOptional({
    description: 'Início do período (ISO 8601). Obrigatório quando `period=custom`.',
    example: '2026-10-01',
  })
  @IsOptional()
  @IsISO8601()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Fim do período (ISO 8601). Obrigatório quando `period=custom`.',
    example: '2026-10-31',
  })
  @IsOptional()
  @IsISO8601()
  end_date?: string;
}

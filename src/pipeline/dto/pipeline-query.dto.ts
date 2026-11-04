import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

/** Ordenações aceitas pela visão em Lista (`Tela 04-B`). */
export const PIPELINE_ORDER_BY = [
  'ticket_desc',
  'ticket_asc',
  'created_at_desc',
  'close_date_asc',
  'probability_desc',
] as const;

export type PipelineOrderBy = (typeof PIPELINE_ORDER_BY)[number];

/** Valores especiais de `assigned_user_id` além do UUID do vendedor. */
export const ASSIGNED_USER_SPECIAL_VALUES = ['me', 'all'] as const;

/** `true`/`false` vindos da query string não são booleanos para o Nest. */
function toBoolean(value: unknown): unknown {
  if (value === 'true' || value === true) {
    return true;
  }

  if (value === 'false' || value === false) {
    return false;
  }

  return value;
}

/**
 * Query do Funil de Vendas (`GET /leads/pipeline`, spec §2.5).
 *
 * Todos os filtros são opcionais: sem nenhum, a rota devolve o funil inteiro
 * do tenant (respeitando o RBAC do vendedor).
 */
export class PipelineQueryDto {
  @ApiPropertyOptional({
    description: 'Código da etapa (ex.: `2_qualificacao`) ou `all` para todas.',
    example: '4_proposta',
  })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({
    description: '`me`, `all` ou o UUID do vendedor. Vendedor sempre vê só os seus.',
    example: 'me',
  })
  @IsOptional()
  @ValidateIf((query: PipelineQueryDto) =>
    !ASSIGNED_USER_SPECIAL_VALUES.includes(
      query.assigned_user_id as (typeof ASSIGNED_USER_SPECIAL_VALUES)[number],
    ),
  )
  @IsUUID()
  assigned_user_id?: string;

  @ApiPropertyOptional({ description: 'Ticket mínimo (R$).', example: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ticket_min?: number;

  @ApiPropertyOptional({ description: 'Ticket máximo (R$).', example: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ticket_max?: number;

  @ApiPropertyOptional({
    description: 'Quando `true`, devolve apenas cards com alerta de inatividade (> 48h).',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  has_alerts?: boolean;

  @ApiPropertyOptional({
    description: 'Busca por razão social, nome fantasia ou CNPJ.',
    example: 'solar',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: PIPELINE_ORDER_BY,
    default: 'ticket_desc',
    description: 'Ordenação dos cards dentro de cada coluna.',
  })
  @IsOptional()
  @IsIn(PIPELINE_ORDER_BY)
  order_by?: PipelineOrderBy;
}

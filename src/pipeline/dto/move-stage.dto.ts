import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Corpo do drag-and-drop do Kanban (`PATCH /leads/:id/stage`).
 *
 * `stage_id` é o UUID da etapa. `stage` e `new_stage` são aceitos como
 * alternativa por **código** (`4_proposta`), que é o formato usado pela
 * especificação de produto (`task-s04-02.md`) — o service resolve os três.
 */
export class MoveStageDto {
  @ApiPropertyOptional({
    description: 'UUID da etapa de destino.',
    example: 'a1b2c3d4-0000-4000-8000-000000000004',
  })
  @IsOptional()
  @IsUUID()
  stage_id?: string;

  @ApiPropertyOptional({
    description: 'Código da etapa de destino (alternativa a `stage_id`).',
    example: '4_proposta',
  })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({
    description: 'Apelido de `stage`, usado pela especificação do Kanban.',
    example: '4_proposta',
  })
  @IsOptional()
  @IsString()
  new_stage?: string;

  @ApiPropertyOptional({
    description: 'Versão atual do card (lock otimista).',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    description: 'Apelido de `version`, usado pela especificação do Kanban.',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version?: number;

  @ApiPropertyOptional({
    description: 'Código do motivo da perda — obrigatório ao mover para a etapa de perda.',
    example: 'preco',
  })
  @IsOptional()
  @IsString()
  loss_reason_code?: string;

  @ApiPropertyOptional({
    description: 'Observações livres sobre a perda.',
    example: 'Cliente fechou com concorrente em 12x sem juros.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  loss_reason_notes?: string;
}

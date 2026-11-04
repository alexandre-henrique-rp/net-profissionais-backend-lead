import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Corpo do Modal 1 de Overlays (`PUT /leads/:id/commercial-terms`, spec §3.2).
 *
 * Só os termos comerciais vivem aqui: etapa e vendedor responsável têm rotas
 * próprias (`PATCH /leads/:id/stage` e o módulo de usuários), então o modal
 * não consegue burlar a regra de motivo obrigatório da etapa de perda.
 */
export class CommercialTermsDto {
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
    description: 'Apelido de `version`, usado pela especificação do modal.',
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version?: number;

  @ApiPropertyOptional({ description: 'Valor da proposta em reais (>= 0).', example: 42000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  ticket_value?: number;

  @ApiPropertyOptional({
    description: 'Probabilidade de fechamento em percentual (0 a 100).',
    example: 70,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  close_probability?: number;

  @ApiPropertyOptional({
    description: 'Apelido de `close_probability`, usado pela especificação do modal.',
    example: 70,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  close_probability_percentage?: number;

  @ApiPropertyOptional({
    description: 'Data prevista de fechamento (ISO 8601, hoje ou no futuro).',
    example: '2026-11-15',
  })
  @IsOptional()
  @IsISO8601()
  expected_close_date?: string;

  @ApiPropertyOptional({
    description: 'Escopo descritivo da proposta.',
    example: 'Sistema solar fotovoltaico de 50kWp com homologação completa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  proposal_scope?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Corpo do `POST /leads/:id/unlink` — botão "Desvincular-me do Lead".
 *
 * O motivo é opcional; quando vem, vira o conteúdo da nota de
 * `STATUS_CHANGE` na linha do tempo e alimenta o histórico do Pool.
 */
export class UnlinkLeadDto {
  @ApiPropertyOptional({
    example: 'Carteira cheia: preciso priorizar as oportunidades em proposta.',
    maxLength: 2000,
    description: 'Motivo da devolução ao Pool (opcional).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

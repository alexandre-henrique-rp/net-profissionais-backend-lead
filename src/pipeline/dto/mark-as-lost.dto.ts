import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Corpo do Modal 2 de Overlays (`POST /leads/:id/mark-as-lost`, spec §3.3).
 *
 * `loss_reason_code` é validado contra o catálogo de 6 causas em
 * `loss-reasons.ts` — não aqui, para o erro sair com o código de contrato
 * (`LOSS_REASON_REQUIRED`) e não como 400 genérico do `class-validator`.
 */
export class MarkAsLostDto {
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

  @ApiProperty({
    description: 'Um dos 6 códigos parametrizados de motivo da perda.',
    example: 'preco',
  })
  @IsString()
  @IsNotEmpty()
  loss_reason_code!: string;

  @ApiPropertyOptional({
    description: 'Histórico e observações do descarte.',
    example: 'Cliente informou que o concorrente ofertou 12x sem juros.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  loss_reason_notes?: string;

  @ApiPropertyOptional({
    description: 'Apelido de `loss_reason_notes`, usado pela especificação do modal.',
    example: 'Cliente informou que o concorrente ofertou 12x sem juros.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additional_notes?: string;
}

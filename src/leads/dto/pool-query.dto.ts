import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Query do `GET /leads/pool` (seção 2.4 do contrato de endpoints).
 *
 * Os campos de enumeração chegam como texto livre (`all`, minúsculo ou
 * maiúsculo) porque o frontend monta a query a partir dos selects do Penpot;
 * a normalização para o enum do banco acontece no serviço.
 */
export class PoolQueryDto {
  @ApiPropertyOptional({
    example: 'solar',
    description: 'Busca por empresa, documento ou contato.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    example: 'MG',
    description: '`all` ou a sigla de 2 letras.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(all|[A-Za-z]{2})$/i, {
    message: 'uf deve ser "all" ou uma sigla de 2 letras.',
  })
  uf?: string;

  @ApiPropertyOptional({
    example: 'solar',
    description: '`all` ou um setor do tenant.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sector?: string;

  @ApiPropertyOptional({
    example: 'instaladores',
    description: 'Busca textual pela categoria interna da oportunidade.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  custom_sector?: string;

  @ApiPropertyOptional({ enum: ['all', 'ME', 'EPP', 'DEMAIS'], example: 'ME' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  company_size?: string;

  @ApiPropertyOptional({ enum: ['all', 'hot', 'warm', 'cold'], example: 'hot' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  temperature?: string;

  @ApiPropertyOptional({
    enum: ['available', 'claimed', 'unassigned', 'returned_to_pool'],
    example: 'available',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

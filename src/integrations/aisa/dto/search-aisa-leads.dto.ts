import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AISA_SEARCH_ENGINES,
  type AisaSearchEngine,
} from '../aisa.types.js';

/** Corpo do `POST /integrations/aisa/search`. */
export class SearchAisaLeadsDto {
  @ApiProperty({
    example: 'Energia Solar',
    description: 'Segmento ou nicho de mercado das empresas.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Informe o segmento ou nicho da pesquisa.' })
  @MaxLength(160)
  segment!: string;

  @ApiPropertyOptional({ example: 'Belo Horizonte' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'MG', description: 'UF com 2 letras.' })
  @IsOptional()
  @IsString()
  @Matches(/^$|^[A-Za-z]{2}$/, {
    message: 'Informe a UF com 2 letras (ex.: MG, SP).',
  })
  state?: string;

  @ApiPropertyOptional({ example: 'integradores fotovoltaicos B2B' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keywords?: string;

  @ApiPropertyOptional({ enum: ['ME', 'EPP', 'DEMAIS'] })
  @IsOptional()
  @IsIn(['ME', 'EPP', 'DEMAIS'])
  company_size?: 'ME' | 'EPP' | 'DEMAIS';

  @ApiPropertyOptional({ enum: AISA_SEARCH_ENGINES, default: 'auto' })
  @IsOptional()
  @IsIn(AISA_SEARCH_ENGINES)
  engine?: AisaSearchEngine;

  @ApiPropertyOptional({
    default: true,
    description: 'Extrai conteúdo detalhado das páginas encontradas via Aisa.',
  })
  @IsOptional()
  @IsBoolean()
  deep_extract?: boolean;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  max_results?: number;
}

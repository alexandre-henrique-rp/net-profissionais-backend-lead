import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AI_LLM_PROVIDERS, type AiLlmProvider } from '../aisa.types.js';

/** Corpo do `PUT /integrations/aisa/config`. */
export class UpdateAisaConfigDto {
  @ApiPropertyOptional({
    description: 'Chave da API Aisa (omitir ou vazio mantém a salva).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  aisa_api_key?: string;

  @ApiPropertyOptional({ description: 'Remove a chave Aisa salva.' })
  @IsOptional()
  @IsBoolean()
  clear_aisa_api_key?: boolean;

  @ApiPropertyOptional({
    example: 'https://api.aisa.one',
    description: 'URL base da API REST Aisa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  aisa_base_url?: string;

  @ApiPropertyOptional({
    enum: AI_LLM_PROVIDERS,
    description: 'Provedor de IA usado para estruturar os leads.',
  })
  @IsOptional()
  @IsIn(AI_LLM_PROVIDERS)
  llm_provider?: AiLlmProvider;

  @ApiPropertyOptional({
    example: 'gemini-2.5-flash',
    description: 'Identificador do modelo no provedor selecionado.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  llm_model?: string;

  @ApiPropertyOptional({
    description: 'Chave/token do provedor de IA (omitir mantém a salva).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  llm_api_key?: string;

  @ApiPropertyOptional({ description: 'Remove a chave do provedor de IA.' })
  @IsOptional()
  @IsBoolean()
  clear_llm_api_key?: boolean;

  @ApiPropertyOptional({
    example: 'https://meu-endpoint.exemplo.com/v1/chat/completions',
    description: 'URL do endpoint customizado compatível com chat completions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  llm_base_url?: string;
}

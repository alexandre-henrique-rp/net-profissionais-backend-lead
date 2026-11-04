import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  registerDecorator,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';
import { PeriodQueryDto } from '../../dashboard/dto/period-query.dto.js';
import { EXPORT_FORMATS, type ExportFormat } from '../export.types.js';

/** `me`, `all` ou o UUID de um vendedor (§2.5). */
export const ASSIGNED_USER_SPECIAL_VALUES = ['me', 'all'] as const;

/** Agrupamentos de CNAE aceitos (o `all` desliga o filtro). */
export const EXPORT_SECTORS = [
  'all',
  'solar',
  'tecnologia',
  'construcao',
  'servicos',
  'outros',
] as const;

/** Classificação fiscal da Receita Federal. */
export const EXPORT_COMPANY_SIZES = ['ALL', 'ME', 'EPP', 'DEMAIS'] as const;

/**
 * Temperatura comercial: aceita as faixas do contrato (`hot`/`warm`/`cold`) e
 * os rótulos do banco (`quente`/`morno`/`frio`).
 */
export const EXPORT_TEMPERATURES = [
  'all',
  'hot',
  'warm',
  'cold',
  'quente',
  'morno',
  'frio',
] as const;

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function toLowerCase(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function toUpperCase(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/**
 * Valida a faixa de ticket como um todo (`ticket_min <= ticket_max`).
 *
 * Cada campo isolado passa por `@IsNumber`/`@Min`, mas a faixa invertida
 * (`ticket_min=100&ticket_max=50`) produzia `200` com um arquivo só de
 * cabeçalho — o usuário baixava um CSV "vazio" sem saber que o filtro era
 * impossível. O erro agora é `400 VALIDATION_ERROR`.
 */
function IsTicketRangeValid(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isTicketRangeValid',
      target: object.constructor,
      propertyName,
      options: {
        message: '`ticket_min` não pode ser maior que `ticket_max`.',
        ...validationOptions,
      },
      validator: {
        validate(_value: unknown, args): boolean {
          const query = args?.object as ExportQueryDto | undefined;

          if (!query) {
            return true;
          }

          if (query.ticket_min === undefined || query.ticket_max === undefined) {
            return true;
          }

          return query.ticket_min <= query.ticket_max;
        },
      },
    });
  };
}

/**
 * Query de `GET /api/v1/leads/export` (§2.6).
 *
 * Herda `period`/`start_date`/`end_date` do dashboard para que o botão de
 * exportação respeite exatamente o recorte temporal da tela.
 */
export class ExportQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({
    enum: EXPORT_FORMATS,
    default: 'csv',
    description: 'Formato do arquivo gerado.',
    example: 'csv',
  })
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format: ExportFormat = 'csv';

  @ApiPropertyOptional({
    description: 'Busca textual por razão social, fantasia, CNPJ/CPF ou contato.',
    example: 'solar',
  })
  @IsOptional()
  @Transform(({ value }) => trim(value))
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({
    description: 'UF da sede (`all` ou a sigla de 2 letras).',
    example: 'MG',
  })
  @IsOptional()
  @Transform(({ value }) => toUpperCase(value))
  @Matches(/^(ALL|[A-Z]{2})$/, {
    message: 'uf deve ser `all` ou uma sigla de 2 letras',
  })
  uf?: string;

  @ApiPropertyOptional({ enum: EXPORT_SECTORS, default: 'all' })
  @IsOptional()
  @Transform(({ value }) => toLowerCase(value))
  @IsIn(EXPORT_SECTORS)
  sector?: string;

  @ApiPropertyOptional({ enum: EXPORT_COMPANY_SIZES, default: 'ALL' })
  @IsOptional()
  @Transform(({ value }) => toUpperCase(value))
  @IsIn(EXPORT_COMPANY_SIZES)
  company_size?: string;

  @ApiPropertyOptional({ enum: EXPORT_TEMPERATURES, default: 'all' })
  @IsOptional()
  @Transform(({ value }) => toLowerCase(value))
  @IsIn(EXPORT_TEMPERATURES)
  temperature?: string;

  @ApiPropertyOptional({
    description: 'Código da etapa (ex.: `4_proposta`) ou `all`.',
    example: '4_proposta',
  })
  @IsOptional()
  @IsString()
  stage?: string;

  @ApiPropertyOptional({
    description: '`me`, `all` ou o UUID do vendedor. Vendedor exporta só a própria carteira.',
    example: 'me',
  })
  @IsOptional()
  @ValidateIf((query: ExportQueryDto) =>
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
  @IsTicketRangeValid()
  ticket_max?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PersonType } from '../../generated/prisma/client.js';
import { WEBHOOK_SOURCES, type WebhookSource } from '../webhook.constants.js';

/** Contato/decisor que veio no formulário da landing page. */
export class WebhookContactDto {
  @ApiProperty({ example: 'Carlos Alberto de Souza', minLength: 2, maxLength: 150 })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({ example: 'Gerente de Suprimentos' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @ApiPropertyOptional({ example: '11987654321', description: 'DDD + número (10 ou 11 dígitos).' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'carlos.compras@eletrominas.com.br' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ example: '1985-06-15', description: 'Data de nascimento (ISO 8601).' })
  @IsOptional()
  @IsISO8601()
  birthday?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Sócio/decisor (vem marcado do QSA).' })
  @IsOptional()
  @IsBoolean()
  is_decision_maker?: boolean;
}

/** Endereço do cliente ou da obra — opcional, usado nas abas 2 e 3. */
export class WebhookAddressDto {
  @ApiPropertyOptional({ example: '01310-100' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  postal_code?: string;

  @ApiPropertyOptional({ example: 'Avenida Paulista' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;

  @ApiPropertyOptional({ example: '1000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string;

  @ApiPropertyOptional({ example: 'Sala 52 - Bloco B' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string;

  @ApiPropertyOptional({ example: 'Bela Vista' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @ApiPropertyOptional({ example: 'São Paulo' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'SP' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;
}

/** Empresa/pessoa captada — documento, razão social e contatos. */
export class WebhookLeadDto {
  @ApiProperty({
    example: '12.345.678/0001-90',
    description:
      'CNPJ (14 dígitos) para pessoa jurídica ou CPF (11 dígitos) para pessoa física. Aceita máscara.',
  })
  @IsString()
  @MaxLength(20)
  document!: string;

  @ApiPropertyOptional({
    enum: PersonType,
    description: 'Opcional: quando ausente, o tipo é inferido pelo tamanho do documento.',
  })
  @IsOptional()
  @IsEnum(PersonType)
  person_type?: PersonType;

  @ApiPropertyOptional({ example: 'Eletro Minas Distribuidora LTDA' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string;

  @ApiPropertyOptional({ example: 'Eletro Minas' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trade_name?: string;

  @ApiPropertyOptional({
    example: 'Preciso de cotação para cabo flexível 16mm e disjuntores.',
    description: 'Mensagem do formulário — vira o conteúdo da primeira nota da linha do tempo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiProperty({ type: [WebhookContactDto], description: 'Ao menos um contato é obrigatório.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WebhookContactDto)
  contacts!: WebhookContactDto[];

  @ApiPropertyOptional({ type: WebhookAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookAddressDto)
  address?: WebhookAddressDto;
}

/**
 * Corpo do `POST /webhooks/leads/:tenantId`.
 *
 * O nome do campo de consentimento segue o contrato da API (`lgpd_consent`) e
 * não o `consent.lgpd_accepted` do formulário antigo. O DTO só confere o tipo
 * (booleano): quem decide se a captação pode acontecer é o service, para que
 * `false` **e** ausente respondam o código de negócio `LGPD_CONSENT_REQUIRED`
 * (422) — e não um 400 de validação.
 */
export class WebhookLeadPayloadDto {
  @ApiProperty({ type: WebhookLeadDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => WebhookLeadDto)
  lead!: WebhookLeadDto;

  @ApiPropertyOptional({
    enum: WEBHOOK_SOURCES,
    example: 'google_ads',
    description: 'Origem do lead (usada no Dashboard e na primeira nota).',
  })
  @IsOptional()
  @IsIn(WEBHOOK_SOURCES)
  source?: WebhookSource;

  @ApiPropertyOptional({
    enum: WEBHOOK_SOURCES,
    description: 'Apelido de `source` — o primeiro preenchido vence.',
  })
  @IsOptional()
  @IsIn(WEBHOOK_SOURCES)
  channel?: WebhookSource;

  /**
   * `@IsOptional()` não torna o campo opcional no contrato: sem ele a captação
   * é recusada de qualquer forma. Serve para o DTO não antecipar um 400
   * `VALIDATION_ERROR` e deixar o service responder o código de negócio
   * `LGPD_CONSENT_REQUIRED` (422) — o mesmo que ele já faz com `false`.
   * O tipo continua estrito: `"true"` (string) é recusado aqui.
   */
  @ApiProperty({
    example: true,
    description: 'Obrigatoriamente `true` (LGPD). Ausente responde 422 `LGPD_CONSENT_REQUIRED`.',
  })
  @IsOptional()
  @IsBoolean()
  lgpd_consent!: boolean;

  @ApiPropertyOptional({
    example: '2026-10-23T14:30:00Z',
    description: 'Momento do aceite do termo (prova de consentimento).',
  })
  @IsOptional()
  @IsISO8601()
  consent_at?: string;

  @ApiPropertyOptional({
    example: { utm_source: 'google', utm_campaign: 'solar_q4' },
    description: 'Metadados livres da campanha (até 20 chaves simples).',
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CompanySize,
  LeadSpecialDateType,
  LeadTemperature,
  PersonType,
  TenantSector,
} from '../../generated/prisma/client.js';

/** Só os dígitos do documento — aceita a máscara que o captador digita. */
function digitsOnly(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\D/g, '') : value;
}

/** Contato do lead no Modal de Cadastro Híbrido (sócio do QSA ou indicação). */
export class ManualLeadContactDto {
  @ApiProperty({ example: 'Marcelo Dias' })
  @IsString()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ example: 'Sócio-Diretor' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  role?: string;

  @ApiPropertyOptional({ example: '31988887777' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'marcelo@solartech.com.br' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  email?: string;

  @ApiPropertyOptional({
    example: '1982-11-14',
    description: 'Data de nascimento (ISO 8601).',
  })
  @IsOptional()
  @IsISO8601()
  birthday?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Sócio decisor (vem marcado do QSA).',
  })
  @IsOptional()
  @IsBoolean()
  is_decision_maker?: boolean;
}

/** Data comemorativa usada nos alertas de relacionamento. */
export class ManualLeadSpecialDateDto {
  @ApiProperty({
    enum: LeadSpecialDateType,
    example: LeadSpecialDateType.ANIVERSARIO_SOCIO,
  })
  @IsEnum(LeadSpecialDateType)
  date_type: LeadSpecialDateType;

  @ApiProperty({ example: '14/11', description: 'Dia e mês no formato DD/MM.' })
  @Matches(/^\d{2}\/\d{2}$/, {
    message: 'day_month deve estar no formato DD/MM.',
  })
  day_month: string;

  @ApiPropertyOptional({ example: 'Aniversário do sócio Marcelo Dias' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

/**
 * Corpo do `POST /leads/manual` (`03-C-D.Modal-CadastroLead`).
 *
 * A obrigatoriedade do documento depende de `person_type`: PJ exige CNPJ com
 * 14 dígitos, PF exige CPF com 11. O resto é opcional — o modal permite
 * cadastro rápido só com documento e contato.
 */
export class CreateManualLeadDto {
  @ApiProperty({ enum: PersonType, example: PersonType.PJ })
  @IsEnum(PersonType)
  person_type: PersonType;

  @ApiPropertyOptional({
    example: '33.456.789/0001-02',
    description: 'Obrigatório para PJ.',
  })
  @Transform(({ value }) => digitsOnly(value))
  @ValidateIf((dto: CreateManualLeadDto) => dto.person_type === PersonType.PJ)
  @IsString({ message: 'O CNPJ é obrigatório para pessoa jurídica.' })
  @Matches(/^\d{14}$/, { message: 'O CNPJ deve ter 14 dígitos.' })
  cnpj?: string;

  @ApiPropertyOptional({
    example: '123.456.789-01',
    description: 'Obrigatório para PF.',
  })
  @Transform(({ value }) => digitsOnly(value))
  @ValidateIf((dto: CreateManualLeadDto) => dto.person_type === PersonType.PF)
  @IsString({ message: 'O CPF é obrigatório para pessoa física.' })
  @Matches(/^\d{11}$/, { message: 'O CPF deve ter 11 dígitos.' })
  cpf?: string;

  @ApiPropertyOptional({ example: 'Solar Tech Engenharia LTDA' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string;

  @ApiPropertyOptional({ example: 'Solar Tech' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trade_name?: string;

  @ApiPropertyOptional({ example: '4321500' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  primary_cnae?: string;

  @ApiPropertyOptional({ example: 'Instalação e manutenção elétrica' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cnae_description?: string;

  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  capital_social?: number;

  @ApiPropertyOptional({ example: '30130-110' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  postal_code?: string;

  @ApiPropertyOptional({ example: 'Av. Afonso Pena' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;

  @ApiPropertyOptional({ example: '1500' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string;

  @ApiPropertyOptional({ example: 'Sala 402' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string;

  @ApiPropertyOptional({ example: 'Centro' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @ApiPropertyOptional({ example: 'Belo Horizonte' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'MG' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  state?: string;

  @ApiPropertyOptional({
    enum: TenantSector,
    deprecated: true,
    description:
      'Legado: o setor oficial é derivado do CNAE e este valor é ignorado.',
  })
  @IsOptional()
  @IsEnum(TenantSector)
  sector?: TenantSector;

  @ApiPropertyOptional({ example: 'Rede de instaladores', maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(100)
  custom_sector?: string;

  @ApiPropertyOptional({ enum: CompanySize, example: CompanySize.EPP })
  @IsOptional()
  @IsEnum(CompanySize)
  company_size?: CompanySize;

  @ApiPropertyOptional({
    enum: LeadTemperature,
    example: LeadTemperature.QUENTE,
  })
  @IsOptional()
  @IsEnum(LeadTemperature)
  temperature?: LeadTemperature;

  @ApiPropertyOptional({ type: [ManualLeadContactDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualLeadContactDto)
  contacts?: ManualLeadContactDto[];

  @ApiPropertyOptional({ type: [ManualLeadSpecialDateDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualLeadSpecialDateDto)
  special_dates?: ManualLeadSpecialDateDto[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Quando verdadeiro, o lead já entra na carteira de quem cadastrou.',
  })
  @IsOptional()
  @IsBoolean()
  assign_to_me?: boolean;
}

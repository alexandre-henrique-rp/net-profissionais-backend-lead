import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ImportAisaContactDto {
  @ApiPropertyOptional({ example: 'Marcelo Dias' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: 'Diretor Comercial' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @ApiPropertyOptional({ example: '31999998888' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'contato@empresa.com.br' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;
}

export class ImportAisaLeadItemDto {
  @ApiProperty({ example: 'Solar Tech Engenharia LTDA' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da empresa.' })
  @MaxLength(200)
  company_name!: string;

  @ApiPropertyOptional({ example: 'Solar Tech' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trade_name?: string;

  @ApiPropertyOptional({ example: '33456789000102' })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  cnpj?: string;

  @ApiPropertyOptional({ example: 'https://solartech.com.br' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional({ example: 'Belo Horizonte' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'MG' })
  @IsOptional()
  @IsString()
  @Matches(/^$|^[A-Za-z]{2}$/, { message: 'UF inválida.' })
  state?: string;

  @ApiPropertyOptional({ example: 'Energia Solar' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  custom_sector?: string;

  @ApiPropertyOptional({ enum: ['ME', 'EPP', 'DEMAIS'] })
  @IsOptional()
  @IsIn(['ME', 'EPP', 'DEMAIS'])
  company_size?: 'ME' | 'EPP' | 'DEMAIS';

  @ApiPropertyOptional({ enum: ['QUENTE', 'MORNO', 'FRIO'] })
  @IsOptional()
  @IsIn(['QUENTE', 'MORNO', 'FRIO'])
  temperature?: 'QUENTE' | 'MORNO' | 'FRIO';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  source_url?: string;

  @ApiPropertyOptional({ type: ImportAisaContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportAisaContactDto)
  contact?: ImportAisaContactDto;
}

/** Corpo do `POST /integrations/aisa/import`. */
export class ImportAisaLeadsDto {
  @ApiPropertyOptional({ example: 'Energia Solar' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  custom_sector?: string;

  @ApiProperty({ type: [ImportAisaLeadItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione pelo menos um lead para importar.' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ImportAisaLeadItemDto)
  leads!: ImportAisaLeadItemDto[];
}

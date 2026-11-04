import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  OperationalRole,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';

/** Filtros e paginação do `GET /users`. */
export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Busca por nome ou e-mail (case-insensitive).',
    example: 'alexandre',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'Papel de corpus.' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: OperationalRole,
    description: 'Subfunção operacional (dashboard e navegação).',
  })
  @IsOptional()
  @IsEnum(OperationalRole)
  operational_role?: OperationalRole;

  @ApiPropertyOptional({ enum: UserStatus, description: 'Situação da conta.' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Página (a partir de 1).', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Itens por página (máximo 100).',
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

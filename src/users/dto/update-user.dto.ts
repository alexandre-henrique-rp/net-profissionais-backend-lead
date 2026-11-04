import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OperationalRole, UserRole } from '../../generated/prisma/client.js';

/**
 * Situações que o Modal 03 (edição de colaborador) pode aplicar.
 *
 * `BLOCKED` fica de fora de propósito: bloquear é a operação destrutiva do
 * Modal 02, que exige reatribuir a carteira de leads e revogar sessões. Aqui
 * só se ativa uma conta pendente ou se devolve uma conta suspensa à ativa.
 */
export const EDITABLE_USER_STATUSES = ['ACTIVE', 'PENDING'] as const;

export type EditableUserStatus = (typeof EDITABLE_USER_STATUSES)[number];

/** Corpo do `PATCH /users/:id` (Modal 03 de `05-B-D.Modais-Users`). */
export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Alexandre Henrique Silva',
    description: 'Nome de exibição.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'Papel de corpus.' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: OperationalRole,
    description: 'Subfunção operacional.',
  })
  @IsOptional()
  @IsEnum(OperationalRole)
  operational_role?: OperationalRole;

  @ApiPropertyOptional({
    enum: EDITABLE_USER_STATUSES,
    description: 'Situação da conta. Bloqueio é feito por `POST /users/:id/block`.',
  })
  @IsOptional()
  @IsIn(EDITABLE_USER_STATUSES, {
    message: 'A situação deve ser ACTIVE ou PENDING. Use o bloqueio para suspender.',
  })
  status?: EditableUserStatus;
}

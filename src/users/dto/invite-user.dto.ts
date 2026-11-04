import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OperationalRole, UserRole } from '../../generated/prisma/client.js';

/** Corpo do `POST /users/invite` (Modal 01 de `05-B-D.Modais-Users`). */
export class InviteUserDto {
  @ApiProperty({ example: 'Roberto Vendas', description: 'Nome de exibição.' })
  @IsString()
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: 'roberto.vendas@eletrominas.com.br',
    description: 'E-mail que receberá o convite.',
  })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(180)
  email!: string;

  @ApiProperty({
    enum: OperationalRole,
    description: 'Subfunção operacional: define dashboard e navegação.',
    example: 'VENDEDOR',
  })
  @IsEnum(OperationalRole, {
    message: 'O papel operacional deve ser ADMIN, CAPTADOR ou VENDEDOR.',
  })
  operational_role!: OperationalRole;

  @ApiPropertyOptional({
    enum: UserRole,
    default: UserRole.USUARIO,
    description: 'Papel de corpus. O padrão é USUARIO.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

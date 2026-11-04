import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Corpo do `POST /auth/reset-password`. */
export class ResetPasswordDto {
  @ApiProperty({
    description: 'Token enviado por e-mail (UUID de uso único, TTL de 15 min).',
    example: '9f1d1e04-2f3d-4a6c-9a1b-0f2a1e3b4c5d',
  })
  @IsString()
  @IsNotEmpty({ message: 'O token é obrigatório.' })
  token!: string;

  @ApiProperty({
    description: 'Nova senha. Mínimo de 8 caracteres.',
    example: 'NovaSenha123!',
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  @MaxLength(120)
  password!: string;
}

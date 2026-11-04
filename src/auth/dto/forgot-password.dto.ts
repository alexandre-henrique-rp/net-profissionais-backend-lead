import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Corpo do `POST /auth/forgot-password`.
 *
 * A resposta é sempre a mesma, exista ou não a conta — o DTO não pode dar
 * pistas de validação diferentes para e-mail existente e inexistente.
 */
export class ForgotPasswordDto {
  @ApiProperty({
    example: 'carlos.admin@netprofissional.com.br',
    description: 'E-mail da conta que pediu a redefinição.',
  })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(180)
  email!: string;
}

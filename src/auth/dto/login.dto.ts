import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Corpo do `POST /auth/login`. */
export class LoginDto {
  @ApiProperty({
    example: 'carlos.admin@netprofissional.com.br',
    description: 'E-mail cadastrado na corporação.',
  })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(180)
  email!: string;

  @ApiProperty({ example: 'SenhaForte123!', description: 'Senha da conta.' })
  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  password!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

/** Corpo do `POST /users/:id/block` (Modal 02 de `05-B-D.Modais-Users`). */
export class BlockUserDto {
  @ApiProperty({
    description:
      'Colaborador ativo do mesmo tenant que assume a carteira de leads do usuário bloqueado.',
    example: '6f1d1e04-2f3d-4a6c-9a1b-0f2a1e3b4c5d',
  })
  @IsUUID(undefined, {
    message: 'Informe o identificador de um colaborador válido.',
  })
  @IsNotEmpty({ message: 'Escolha o colaborador que vai assumir os leads.' })
  reassign_to_user_id!: string;
}

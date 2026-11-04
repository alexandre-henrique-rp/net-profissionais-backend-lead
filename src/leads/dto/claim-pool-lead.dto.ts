import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Corpo (opcional) do `POST /leads/pool/:id/claim`.
 *
 * `version` é o controle de concorrência otimista: o cliente envia a versão
 * que enxergou na listagem. Se outro usuário assumiu o lead no meio do
 * caminho, o número já mudou e a captação é recusada com `VERSION_CONFLICT`.
 *
 * `expected_version` é o nome usado pela especificação do Pool
 * (`task-s03-04`). Sem o alias, o `whitelist` do `ValidationPipe` descartava o
 * campo e o lock otimista ficava silenciosamente desligado.
 *
 * `assign_to_user_id` permite ao Admin atribuir a captação a um vendedor do
 * tenant; para VENDEDOR/CAPTADOR o campo é ignorado.
 */
export class ClaimPoolLeadDto {
  @ApiPropertyOptional({ example: 3, minimum: 1, description: 'Versão lida na listagem do Pool.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    description: 'Apelido de `version`, usado pela especificação do Pool.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version?: number;

  @ApiPropertyOptional({
    description: 'Somente Admin: UUID do vendedor que receberá o lead.',
    example: 'a1b2c3d4-0000-4000-8000-000000000010',
  })
  @IsOptional()
  @IsString()
  assign_to_user_id?: string;
}

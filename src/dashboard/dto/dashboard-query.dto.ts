import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ACQUISITION_CHANNELS, type AcquisitionChannel } from '../channel.js';
import { PeriodQueryDto } from './period-query.dto.js';

/**
 * Query comum às três telas de dashboard: período + canal de aquisição.
 *
 * O canal é validado pelo contrato (§2.3) mesmo sendo no-op no MVP 1 — quando
 * a coluna existir, o frontend já envia o parâmetro certo.
 */
export class DashboardQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({
    enum: ACQUISITION_CHANNELS,
    default: 'all',
    description:
      'Canal de aquisição. Sem efeito no MVP 1: o schema ainda não guarda a origem do lead.',
    example: 'all',
  })
  @IsOptional()
  @IsIn(ACQUISITION_CHANNELS)
  channel?: AcquisitionChannel;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  normalizeTimelineNoteType,
  TIMELINE_NOTE_TYPES,
  type TimelineNoteTypeInput,
} from '../lead-detail.constants.js';

/**
 * Corpo do `POST /leads/:id/timeline-notes` — botão "+ Salvar Nota" da gaveta.
 *
 * O payload documentado (`doc/mvp/05 §3.4-B`) manda `type` em **minúsculas** e
 * **sem título**: `{ "type": "note", "content": "Cliente pediu reenvio" }`.
 * Por isso `type` é normalizado para maiúsculas (o enum do banco) e `title` é
 * opcional — sem ele, o serviço usa o título padrão do tipo ("Nota",
 * "Ligação", "Reunião"). `content` pode faltar, mas **nota sem título e sem
 * conteúdo** não entra na timeline (400): seria uma linha vazia no histórico.
 */
export class CreateTimelineNoteDto {
  @ApiProperty({
    enum: TIMELINE_NOTE_TYPES,
    example: 'note',
    description: 'Tipo da interação registrada (aceita minúsculas e `whatsapp`).',
  })
  @Transform(({ value }) => normalizeTimelineNoteType(value))
  @IsIn(TIMELINE_NOTE_TYPES, {
    message: `type deve ser um de: ${TIMELINE_NOTE_TYPES.join(', ')}.`,
  })
  type!: TimelineNoteTypeInput;

  @ApiPropertyOptional({
    example: 'Ligação realizada com o decisor',
    minLength: 2,
    maxLength: 120,
    description: 'Opcional: sem título, o serviço usa o padrão do tipo.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({
    example: 'Cliente pediu a proposta revisada para 45 dias de prazo.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional({
    example: '2026-10-27T14:30:00.000Z',
    description:
      'Quando o contato aconteceu (ISO 8601). Ausente, vale o momento do registro.',
  })
  @IsOptional()
  @IsISO8601()
  contacted_at?: string;
}

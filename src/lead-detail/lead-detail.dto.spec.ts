import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizeTimelineNoteType,
  TIMELINE_NOTE_DEFAULT_TITLES,
  TIMELINE_NOTE_TYPES,
} from './lead-detail.constants.js';
import { CreateTimelineNoteDto } from './dto/create-timeline-note.dto.js';
import { UnlinkLeadDto } from './dto/unlink-lead.dto.js';

/** Roda a validação que o `ValidationPipe` global faria no corpo da requisição. */
async function validar<T extends object>(classe: new () => T, corpo: unknown): Promise<string[]> {
  const dto = plainToInstance(classe, corpo);
  const erros = await validate(dto, { whitelist: true });

  return erros.map((erro) => erro.property);
}

describe('CreateTimelineNoteDto', () => {
  it('normaliza o type minúsculo do contrato para o enum do banco', async () => {
    const dto = plainToInstance(CreateTimelineNoteDto, {
      type: 'call',
      content: 'Cliente pediu reenvio da proposta.',
    });

    expect(dto.type).toBe('CALL');
    await expect(validar(CreateTimelineNoteDto, { type: 'note', content: 'ok' })).resolves.toEqual(
      [],
    );
    await expect(
      validar(CreateTimelineNoteDto, { type: 'meeting', content: 'ok' }),
    ).resolves.toEqual([]);
  });

  it('aceita whatsapp como alias de NOTE (o enum do schema não tem WHATSAPP)', () => {
    expect(normalizeTimelineNoteType('whatsapp')).toBe('NOTE');
    expect(normalizeTimelineNoteType('  WhatsApp  ')).toBe('NOTE');
  });

  it('recusa type fora da lista e type ausente', async () => {
    await expect(
      validar(CreateTimelineNoteDto, { type: 'email', content: 'ok' }),
    ).resolves.toEqual(['type']);
    await expect(validar(CreateTimelineNoteDto, { content: 'ok' })).resolves.toEqual(['type']);
  });

  it('exige título com pelo menos 2 caracteres quando ele é enviado', async () => {
    await expect(
      validar(CreateTimelineNoteDto, { type: 'note', title: 'x', content: 'ok' }),
    ).resolves.toEqual(['title']);
    await expect(
      validar(CreateTimelineNoteDto, { type: 'note', title: 'Ok', content: 'ok' }),
    ).resolves.toEqual([]);
  });

  it('aceita nota só com título (o conteúdo é opcional)', async () => {
    await expect(
      validar(CreateTimelineNoteDto, { type: 'note', title: 'Ligação recebida' }),
    ).resolves.toEqual([]);
  });

  it('valida contacted_at como ISO 8601', async () => {
    await expect(
      validar(CreateTimelineNoteDto, {
        type: 'call',
        content: 'ok',
        contacted_at: '2026-10-27T14:30:00.000Z',
      }),
    ).resolves.toEqual([]);
    await expect(
      validar(CreateTimelineNoteDto, { type: 'call', content: 'ok', contacted_at: 'ontem' }),
    ).resolves.toEqual(['contacted_at']);
  });

  it('tem título padrão para cada tipo aceito', () => {
    expect(Object.keys(TIMELINE_NOTE_DEFAULT_TITLES).sort()).toEqual(
      [...TIMELINE_NOTE_TYPES].sort(),
    );
    expect(TIMELINE_NOTE_DEFAULT_TITLES).toEqual({
      NOTE: 'Nota',
      CALL: 'Ligação',
      MEETING: 'Reunião',
    });
  });
});

describe('UnlinkLeadDto', () => {
  it('aceita corpo vazio: o motivo é opcional', async () => {
    await expect(validar(UnlinkLeadDto, {})).resolves.toEqual([]);
  });

  it('aceita motivo em texto livre dentro do limite', async () => {
    await expect(
      validar(UnlinkLeadDto, { reason: 'Carteira cheia: priorizando propostas.' }),
    ).resolves.toEqual([]);
  });

  it('recusa motivo acima de 2000 caracteres', async () => {
    await expect(validar(UnlinkLeadDto, { reason: 'a'.repeat(2001) })).resolves.toEqual([
      'reason',
    ]);
  });
});

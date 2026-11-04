/**
 * Códigos de erro de contrato usados pela ficha do lead.
 *
 * São só os dois da tabela compartilhada: todo lead de outro tenant responde
 * `404 LEAD_NOT_FOUND` (não revelamos que o registro existe em outro lugar) e
 * a violação de carteira responde `403 FORBIDDEN`.
 */
export const LEAD_DETAIL_ERROR_CODES = {
  leadNotFound: 'LEAD_NOT_FOUND',
  forbidden: 'FORBIDDEN',
} as const;

/** Quantas notas a aba de linha do tempo devolve no máximo. */
export const TIMELINE_NOTES_LIMIT = 100;

/**
 * Id fora deste formato estouraria no Postgres (coluna `uuid`) e viraria 500.
 * Validar antes transforma o id malformado no 404 que o contrato pede.
 */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tipos de nota que o vendedor pode registrar pela gaveta. */
export const TIMELINE_NOTE_TYPES = ['NOTE', 'CALL', 'MEETING'] as const;

export type TimelineNoteTypeInput = (typeof TIMELINE_NOTE_TYPES)[number];

/**
 * Título padrão quando o cliente manda só o texto da interação — o payload de
 * `doc/mvp/05 §3.4-B` (`{ "type": "note", "content": "..." }`) não tem título.
 */
export const TIMELINE_NOTE_DEFAULT_TITLES: Record<TimelineNoteTypeInput, string> = {
  NOTE: 'Nota',
  CALL: 'Ligação',
  MEETING: 'Reunião',
};

/**
 * `WHATSAPP` não existe no enum do schema: a conversa é registrada como `NOTE`
 * para o payload documentado não ser recusado com 400.
 */
const TIMELINE_NOTE_TYPE_ALIASES: Record<string, TimelineNoteTypeInput> = {
  WHATSAPP: 'NOTE',
};

/**
 * Normaliza o `type` do corpo: o contrato manda minúsculas (`note|call|meeting`)
 * e o banco guarda maiúsculas. O `whitelist` do `ValidationPipe` não converte
 * nada, então a normalização tem que acontecer no DTO.
 */
export function normalizeTimelineNoteType(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const upper = value.trim().toUpperCase();

  return TIMELINE_NOTE_TYPE_ALIASES[upper] ?? upper;
}

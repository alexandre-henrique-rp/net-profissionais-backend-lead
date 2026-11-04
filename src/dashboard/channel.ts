import type { Prisma } from '../generated/prisma/client.js';

/**
 * Canais de aquisição (`Canal: Todos ▾` — contrato §2.3).
 *
 * O schema do MVP 1 **não** guarda a origem do lead: nem `Lead` nem
 * `TenantLead` têm coluna de canal. O parâmetro é aceito (e validado) pelo
 * contrato, mas o filtro é no-op documentado — ver `buildChannelFilter`.
 */
export const ACQUISITION_CHANNELS = [
  'all',
  'landing_page',
  'google_ads',
  'meta_ads',
  'indicacao',
  'outbound',
  'webhook_api',
] as const;

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

/** Canal padrão: sem recorte de origem. */
export const DEFAULT_CHANNEL: AcquisitionChannel = 'all';

/** Resultado da normalização — `applied` diz se houve filtro de fato. */
export interface ResolvedChannel {
  channel: AcquisitionChannel;
  /** Sempre `false` no MVP 1: não existe coluna de canal para filtrar. */
  applied: boolean;
}

/** Normaliza o valor da query no vocabulário do contrato. */
export function resolveChannel(channel?: string | null): ResolvedChannel {
  const value = channel?.trim().toLowerCase() ?? '';
  const resolved = (ACQUISITION_CHANNELS as readonly string[]).includes(value)
    ? (value as AcquisitionChannel)
    : DEFAULT_CHANNEL;

  // Nenhum canal (nem `all`, nem os demais) consegue virar `where` hoje.
  return { channel: resolved, applied: false };
}

/**
 * Filtro de canal de aquisição para as consultas do dashboard.
 *
 * // ASM: canal não existe no schema do MVP 1 — falta a coluna
 * // (`TenantLead.channel` ou `Lead.source`) e o preenchimento no webhook /
 * // cadastro manual. Enquanto isso, `channel=google_ads` responde exatamente
 * // como `channel=all`, e isso está registrado como assunção do módulo.
 */
export function buildChannelFilter(channel?: string | null): Prisma.TenantLeadWhereInput {
  // Normaliza o valor (ausente/inválido → `all`) mesmo sem poder filtrar:
  // assim o contrato do parâmetro fica validado em um ponto só.
  resolveChannel(channel);

  return {};
}

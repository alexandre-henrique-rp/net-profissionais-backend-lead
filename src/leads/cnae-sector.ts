import { TenantSector } from '../generated/prisma/client.js';

interface CnaeDivisionRange {
  first: number;
  last: number;
  sector: TenantSector;
}

const CNAE_DIVISIONS: CnaeDivisionRange[] = [
  { first: 1, last: 3, sector: TenantSector.AGROPECUARIA },
  { first: 5, last: 9, sector: TenantSector.EXTRATIVISMO },
  { first: 10, last: 33, sector: TenantSector.INDUSTRIA },
  { first: 35, last: 35, sector: TenantSector.ENERGIA },
  { first: 36, last: 39, sector: TenantSector.AGUA_RESIDUOS },
  { first: 41, last: 43, sector: TenantSector.CONSTRUCAO },
  { first: 45, last: 47, sector: TenantSector.COMERCIO },
  { first: 49, last: 53, sector: TenantSector.TRANSPORTE_LOGISTICA },
  { first: 55, last: 56, sector: TenantSector.ALOJAMENTO_ALIMENTACAO },
  { first: 58, last: 63, sector: TenantSector.INFORMACAO_COMUNICACAO },
  { first: 64, last: 66, sector: TenantSector.FINANCAS_SEGUROS },
  { first: 68, last: 68, sector: TenantSector.IMOBILIARIO },
  { first: 69, last: 75, sector: TenantSector.PROFISSIONAL_CIENTIFICO },
  { first: 77, last: 82, sector: TenantSector.ADMINISTRATIVO },
  { first: 84, last: 84, sector: TenantSector.ADMINISTRACAO_PUBLICA },
  { first: 85, last: 85, sector: TenantSector.EDUCACAO },
  { first: 86, last: 88, sector: TenantSector.SAUDE_SOCIAL },
  { first: 90, last: 93, sector: TenantSector.ARTES_LAZER },
  { first: 94, last: 96, sector: TenantSector.SERVICOS },
  { first: 97, last: 97, sector: TenantSector.SERVICOS_DOMESTICOS },
  { first: 99, last: 99, sector: TenantSector.ORGANISMOS_INTERNACIONAIS },
];

/** Deriva a seção CNAE 2.0 pelas divisões do código de atividade principal. */
export function deriveSectorFromCnae(
  cnae: string | number | null | undefined,
): TenantSector {
  const digits = String(cnae ?? '')
    .replace(/\D/g, '')
    .padStart(7, '0');

  if (digits.length !== 7) {
    return TenantSector.OUTROS;
  }

  const division = Number(digits.slice(0, 2));
  const match = CNAE_DIVISIONS.find(
    ({ first, last }) => division >= first && division <= last,
  );

  return match?.sector ?? TenantSector.OUTROS;
}

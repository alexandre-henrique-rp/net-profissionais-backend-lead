import {
  CompanySize as CompanySizeEnum,
  TenantSector as SectorEnum,
  type CompanySize,
  type Prisma,
  type TenantLeadStatus,
  type TenantSector,
} from '../generated/prisma/client.js';
import type { PoolQueryDto } from './dto/pool-query.dto.js';
import { POOL_STATUSES } from './leads.constants.js';

/**
 * Status do Pool aceitos na query → status do banco (seção 2.4).
 *
 * `unassigned` é a leitura de produto de "está livre para captação", então
 * cobre tanto `AVAILABLE` quanto `RETURNED_TO_POOL` — os dois lados do ciclo
 * devolução → nova captação.
 */
const STATUS_FILTERS: Record<string, TenantLeadStatus[]> = {
  available: ['AVAILABLE'],
  claimed: ['CLAIMED'],
  unassigned: POOL_STATUSES,
  returned_to_pool: ['RETURNED_TO_POOL'],
  lost: ['LOST'],
};

/** Escapa os metacaracteres de regex do termo de busca (seção 2.1). */
export function escapeSearchTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `all`, vazio ou ausente não filtram; o resto cai no enum do banco. */
function resolveStatuses(status?: string): TenantLeadStatus[] {
  const key = status?.trim().toLowerCase();

  return (key && STATUS_FILTERS[key]) || POOL_STATUSES;
}

function resolveUf(uf?: string): string | null {
  const value = uf?.trim();

  if (!value || value.toLowerCase() === 'all') {
    return null;
  }

  return value.toUpperCase();
}

function resolveSector(sector?: string): TenantSector | null {
  const value = sector?.trim().toUpperCase();

  if (!value || value === 'ALL') {
    return null;
  }

  return Object.values(SectorEnum).includes(value as TenantSector)
    ? (value as TenantSector)
    : null;
}

function resolveCompanySize(companySize?: string): CompanySize | null {
  const value = companySize?.trim().toUpperCase();

  if (!value || value === 'ALL') {
    return null;
  }

  return Object.values(CompanySizeEnum).includes(value as CompanySize)
    ? (value as CompanySize)
    : null;
}

/**
 * Faixas de temperatura comercial (seção 2.4): o score manda, mas o rótulo
 * manual (`QUENTE`/`MORNO`/`FRIO`) também conta — há lead qualificado à mão
 * sem score calculado.
 */
function resolveTemperature(
  temperature?: string,
): Prisma.LeadWhereInput[] | null {
  switch (temperature?.trim().toLowerCase()) {
    case 'hot':
      return [{ temperatureScore: { gte: 80 } }, { temperature: 'QUENTE' }];
    case 'warm':
      return [
        { temperatureScore: { gte: 50, lte: 79 } },
        { temperature: 'MORNO' },
      ];
    case 'cold':
      return [{ temperatureScore: { lt: 50 } }, { temperature: 'FRIO' }];
    default:
      return null;
  }
}

/**
 * Busca textual (`q`): razão social, nome fantasia, documentos e contatos.
 *
 * O termo é sanitizado para não levar regex para o banco e a versão só com
 * dígitos é usada em CNPJ/CPF/telefone, para que "33.456.789/0001-02" ache o
 * documento gravado sem máscara.
 *
 * Os contatos só entram na busca com o `tenantId` da sessão: o `Lead` é global,
 * mas o nome/telefone/e-mail de um decisor é dado pessoal de quem o cadastrou.
 * Sem o filtro, buscar "Marcelo" acharia o lead de outra corporação por causa
 * do contato dela (LGPD).
 */
function buildSearchConditions(
  term: string | undefined,
  tenantId: string,
): Prisma.LeadWhereInput[] | null {
  const raw = term?.trim();

  if (!raw) {
    return null;
  }

  const escaped = escapeSearchTerm(raw);
  const digits = raw.replace(/\D/g, '');

  const conditions: Prisma.LeadWhereInput[] = [
    { companyName: { contains: escaped, mode: 'insensitive' } },
    { tradeName: { contains: escaped, mode: 'insensitive' } },
    {
      contacts: {
        some: { tenantId, name: { contains: escaped, mode: 'insensitive' } },
      },
    },
    {
      contacts: {
        some: { tenantId, email: { contains: escaped, mode: 'insensitive' } },
      },
    },
  ];

  if (digits.length >= 3) {
    conditions.push(
      { cnpj: { contains: digits } },
      { cpf: { contains: digits } },
      { contacts: { some: { tenantId, phone: { contains: digits } } } },
    );
  }

  return conditions;
}

/**
 * Monta o `where` do `GET /leads/pool`.
 *
 * `tenantId` vem sempre da sessão (nunca da query) e os filtros de empresa
 * entram como `AND` dentro de `lead.is` — inclusive busca e temperatura, que
 * precisam de `OR` próprio sem conflitar entre si.
 */
export function buildPoolWhere(
  query: PoolQueryDto,
  tenantId: string,
): Prisma.TenantLeadWhereInput {
  const leadConditions: Prisma.LeadWhereInput[] = [];
  const customSector = query.custom_sector?.trim();

  const uf = resolveUf(query.uf);
  if (uf) {
    leadConditions.push({ state: uf });
  }

  const sector = resolveSector(query.sector);
  if (sector) {
    leadConditions.push({ sector });
  }

  const companySize = resolveCompanySize(query.company_size);
  if (companySize) {
    leadConditions.push({ companySize });
  }

  const temperature = resolveTemperature(query.temperature);
  if (temperature) {
    leadConditions.push({ OR: temperature });
  }

  const search = buildSearchConditions(query.q, tenantId);
  if (search) {
    leadConditions.push({ OR: search });
  }

  return {
    tenantId,
    status: { in: resolveStatuses(query.status) },
    ...(customSector && customSector.toLowerCase() !== 'all'
      ? { customSector: { contains: customSector, mode: 'insensitive' } }
      : {}),
    ...(leadConditions.length > 0
      ? { lead: { is: { AND: leadConditions } } }
      : {}),
  };
}

/**
 * Ordenação do Pool: quem falou por último primeiro; lead nunca contatado vai
 * para o fim da fila, e o cadastro mais recente desempata.
 */
export const POOL_ORDER_BY: Prisma.TenantLeadOrderByWithRelationInput[] = [
  { lastContactAt: { sort: 'desc', nulls: 'last' } },
  { createdAt: 'desc' },
];

/** Status em que o lead pode ser captado do Pool. */
export const CLAIMABLE_STATUSES: TenantLeadStatus[] = POOL_STATUSES;

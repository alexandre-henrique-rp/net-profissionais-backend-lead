import type { AuthUser } from '../common/auth/auth.types.js';
import { periodDateFilter, resolvePeriod } from '../dashboard/period.js';
import {
  CompanySize,
  LeadTemperature,
  TenantSector,
  type Prisma,
} from '../generated/prisma/client.js';
import type { ExportQueryDto } from './dto/export-query.dto.js';

/**
 * Monta o `where` da exportação (`GET /leads/export`).
 *
 * Repete as regras da listagem do funil (`§2.5`) e da listagem do Pool
 * (`§2.4`) — não reusa o `where` do módulo de leads porque a exportação tem
 * recorte próprio (período + faixa de ticket) e o `where` do Pool é fechado
 * por status. É função pura: recebe o usuário e a query, devolve o filtro.
 */

/** Só entra no relatório o que é do tenant da sessão (`AuthUser.tenantId`, o
 * mesmo valor de `@CurrentTenant()`) — o frontend nunca informa o tenant. */
function buildLeadConditions(
  query: ExportQueryDto,
  tenantId: string,
): Prisma.LeadWhereInput[] {
  const conditions: Prisma.LeadWhereInput[] = [];

  if (query.uf && query.uf !== 'ALL') {
    conditions.push({ state: query.uf });
  }

  if (query.sector && query.sector !== 'all') {
    const sector = query.sector.toUpperCase();

    if (Object.values(TenantSector).includes(sector as TenantSector)) {
      conditions.push({ sector: sector as TenantSector });
    }
  }

  if (query.company_size && query.company_size !== 'ALL') {
    if (Object.values(CompanySize).includes(query.company_size as CompanySize)) {
      conditions.push({ companySize: query.company_size as CompanySize });
    }
  }

  const temperature = resolveTemperature(query.temperature);

  if (temperature) {
    conditions.push({ OR: temperature });
  }

  const search = buildSearchConditions(query.q, tenantId);

  if (search) {
    conditions.push({ OR: search });
  }

  return conditions;
}

/**
 * Faixas de temperatura do contrato (`hot`/`warm`/`cold`) e os rótulos
 * gravados no banco (`QUENTE`/`MORNO`/`FRIO`).
 *
 * O score manda quando existe, mas o rótulo manual também conta: há lead
 * qualificado à mão, sem score calculado.
 */
function resolveTemperature(value?: string): Prisma.LeadWhereInput[] | null {
  switch (value) {
    case 'hot':
    case 'quente':
      return [
        { temperature: LeadTemperature.QUENTE },
        { temperatureScore: { gte: 80 } },
      ];
    case 'warm':
    case 'morno':
      return [
        { temperature: LeadTemperature.MORNO },
        { temperatureScore: { gte: 50, lte: 79 } },
      ];
    case 'cold':
    case 'frio':
      return [{ temperature: LeadTemperature.FRIO }, { temperatureScore: { lt: 50 } }];
    default:
      return null;
  }
}

/**
 * Busca textual (`q`) — mesma semântica da listagem: razão social, fantasia,
 * documentos e dados do contato.
 *
 * CNPJ/CPF e telefone são procurados também só pelos dígitos, para que
 * `33.456.789/0001-02` ache o documento gravado sem máscara.
 */
function buildSearchConditions(
  term: string | undefined,
  tenantId: string,
): Prisma.LeadWhereInput[] | null {
  const raw = term?.trim();

  if (!raw) {
    return null;
  }

  const digits = raw.replace(/\D/g, '');
  // Contatos e datas são dado pessoal escopado por corporação: a busca só
  // enxerga as linhas do tenant da sessão, nunca as de outro tenant que
  // compartilhe a mesma identidade global de `Lead`.
  const tenantContacts = { tenantId };
  const conditions: Prisma.LeadWhereInput[] = [
    { companyName: { contains: raw, mode: 'insensitive' } },
    { tradeName: { contains: raw, mode: 'insensitive' } },
    {
      contacts: {
        some: { ...tenantContacts, name: { contains: raw, mode: 'insensitive' } },
      },
    },
    {
      contacts: {
        some: { ...tenantContacts, email: { contains: raw, mode: 'insensitive' } },
      },
    },
  ];

  if (digits.length >= 3) {
    conditions.push(
      { cnpj: { contains: digits } },
      { cpf: { contains: digits } },
      { contacts: { some: { ...tenantContacts, phone: { contains: digits } } } },
    );
  }

  return conditions;
}

/**
 * Visibilidade da exportação — a mesma da listagem:
 *
 * - **VENDEDOR** exporta apenas a própria carteira, mesmo pedindo `all`;
 * - **ADMIN/CAPTADOR** exportam o tenant, mas podem recortar com `me`;
 * - `all` (ou ausente) não filtra responsável.
 */
function resolveAssignedUser(user: AuthUser, value?: string): string | null {
  if (user.operationalRole === 'VENDEDOR') {
    return user.userId;
  }

  if (!value || value === 'all') {
    return null;
  }

  if (value === 'me') {
    return user.userId;
  }

  return value;
}

/** `where` final da exportação. */
export function buildExportWhere(
  user: AuthUser,
  query: ExportQueryDto,
  now: Date = new Date(),
): Prisma.TenantLeadWhereInput {
  const conditions: Prisma.TenantLeadWhereInput[] = [{ tenantId: user.tenantId }];

  const assignedUserId = resolveAssignedUser(user, query.assigned_user_id);

  if (assignedUserId) {
    conditions.push({ assignedUserId });
  }

  if (query.stage && query.stage !== 'all') {
    conditions.push({ stage: { code: query.stage } });
  }

  if (query.ticket_min !== undefined || query.ticket_max !== undefined) {
    conditions.push({
      ticketValue: {
        ...(query.ticket_min !== undefined ? { gte: query.ticket_min } : {}),
        ...(query.ticket_max !== undefined ? { lte: query.ticket_max } : {}),
      },
    });
  }

  // O mesmo resolvedor do dashboard: `custom` sem as datas (ou invertido)
  // devolve `400 VALIDATION_ERROR`.
  conditions.push(
    periodDateFilter(resolvePeriod(query.period, query.start_date, query.end_date, now)),
  );

  const leadConditions = buildLeadConditions(query, user.tenantId);

  if (leadConditions.length > 0) {
    conditions.push({ lead: { is: { AND: leadConditions } } });
  }

  return { AND: conditions };
}

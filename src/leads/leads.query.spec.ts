import type { Prisma } from '../generated/prisma/client.js';
import type { PoolQueryDto } from './dto/pool-query.dto.js';
import {
  buildPoolWhere,
  CLAIMABLE_STATUSES,
  escapeSearchTerm,
  POOL_ORDER_BY,
} from './leads.query.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

/** Condições aplicadas dentro de `lead.is.AND`. */
function leadConditions(
  where: Prisma.TenantLeadWhereInput,
): Prisma.LeadWhereInput[] {
  const lead = where.lead as
    { is?: { AND?: Prisma.LeadWhereInput[] } } | undefined;

  return lead?.is?.AND ?? [];
}

/** Primeiro `OR` das condições de empresa (temperatura ou busca textual). */
function orConditions(
  where: Prisma.TenantLeadWhereInput,
): Prisma.LeadWhereInput[] {
  const or = leadConditions(where).find((condition) =>
    Array.isArray(condition.OR),
  );

  return (or?.OR as Prisma.LeadWhereInput[]) ?? [];
}

function where(query: PoolQueryDto): Prisma.TenantLeadWhereInput {
  return buildPoolWhere(query, TENANT_ID);
}

describe('buildPoolWhere', () => {
  it('escopa sempre pelo tenantId da sessão', () => {
    expect(where({}).tenantId).toBe(TENANT_ID);
    expect(where({ q: 'solar', uf: 'MG' }).tenantId).toBe(TENANT_ID);
  });

  it('filtra categoria interna por correspondência textual e mantém o tenant @spec:AC-182', () => {
    expect(where({ custom_sector: 'instaladores' })).toMatchObject({
      tenantId: TENANT_ID,
      customSector: { contains: 'instaladores', mode: 'insensitive' },
    });
    expect(where({ custom_sector: 'all' })).not.toHaveProperty('customSector');
  });

  it('por padrão lista apenas leads captáveis (AVAILABLE e RETURNED_TO_POOL) @spec:AC-072', () => {
    expect(where({}).status).toEqual({ in: ['AVAILABLE', 'RETURNED_TO_POOL'] });
  });

  describe('filtros do Pool', () => {
    it('uf normaliza a sigla e ignora "all"', () => {
      expect(leadConditions(where({ uf: 'mg' }))).toContainEqual({
        state: 'MG',
      });
      expect(leadConditions(where({ uf: ' SP ' }))).toContainEqual({
        state: 'SP',
      });
      expect(leadConditions(where({ uf: 'all' }))).toEqual([]);
      expect(leadConditions(where({}))).toEqual([]);
    });

    it('sector cai no enum do banco e ignora valor desconhecido @spec:AC-073', () => {
      expect(leadConditions(where({ sector: 'solar' }))).toContainEqual({
        sector: 'SOLAR',
      });
      expect(leadConditions(where({ sector: 'TECNOLOGIA' }))).toContainEqual({
        sector: 'TECNOLOGIA',
      });
      expect(leadConditions(where({ sector: 'all' }))).toEqual([]);
      expect(leadConditions(where({ sector: 'inexistente' }))).toEqual([]);
    });

    it('company_size cai no enum do banco e ignora valor desconhecido', () => {
      expect(leadConditions(where({ company_size: 'me' }))).toContainEqual({
        companySize: 'ME',
      });
      expect(leadConditions(where({ company_size: 'EPP' }))).toContainEqual({
        companySize: 'EPP',
      });
      expect(leadConditions(where({ company_size: 'DEMAIS' }))).toContainEqual({
        companySize: 'DEMAIS',
      });
      expect(leadConditions(where({ company_size: 'all' }))).toEqual([]);
      expect(leadConditions(where({ company_size: 'GIGANTE' }))).toEqual([]);
    });

    it('status available filtra só AVAILABLE', () => {
      expect(where({ status: 'available' }).status).toEqual({
        in: ['AVAILABLE'],
      });
    });

    it('status claimed filtra só CLAIMED', () => {
      expect(where({ status: 'claimed' }).status).toEqual({ in: ['CLAIMED'] });
    });

    it('status unassigned cobre AVAILABLE e RETURNED_TO_POOL', () => {
      expect(where({ status: 'unassigned' }).status).toEqual({
        in: ['AVAILABLE', 'RETURNED_TO_POOL'],
      });
    });

    it('status returned_to_pool filtra só RETURNED_TO_POOL', () => {
      expect(where({ status: 'returned_to_pool' }).status).toEqual({
        in: ['RETURNED_TO_POOL'],
      });
    });
  });

  describe('temperatura comercial', () => {
    it('hot busca score >= 80 ou rótulo QUENTE @spec:AC-074', () => {
      expect(orConditions(where({ temperature: 'hot' }))).toEqual([
        { temperatureScore: { gte: 80 } },
        { temperature: 'QUENTE' },
      ]);
    });

    it('warm busca score entre 50 e 79 ou rótulo MORNO', () => {
      expect(orConditions(where({ temperature: 'warm' }))).toEqual([
        { temperatureScore: { gte: 50, lte: 79 } },
        { temperature: 'MORNO' },
      ]);
    });

    it('cold busca score < 50 ou rótulo FRIO', () => {
      expect(orConditions(where({ temperature: 'cold' }))).toEqual([
        { temperatureScore: { lt: 50 } },
        { temperature: 'FRIO' },
      ]);
    });

    it('all (ou ausente) não filtra por temperatura', () => {
      expect(orConditions(where({ temperature: 'all' }))).toEqual([]);
      expect(orConditions(where({}))).toEqual([]);
    });
  });

  describe('busca textual (q)', () => {
    it('escapa os metacaracteres de regex do termo', () => {
      expect(escapeSearchTerm('solar.*')).toBe('solar\\.\\*');
      expect(escapeSearchTerm('a+b(c)')).toBe('a\\+b\\(c\\)');
      expect(escapeSearchTerm('[teste]')).toBe('\\[teste\\]');
    });

    it('busca por empresa e por contatos do tenant, nunca por contato de outro @spec:AC-075', () => {
      const conditions = orConditions(where({ q: 'solar.*' }));

      expect(conditions).toContainEqual({
        companyName: { contains: 'solar\\.\\*', mode: 'insensitive' },
      });
      expect(conditions).toContainEqual({
        tradeName: { contains: 'solar\\.\\*', mode: 'insensitive' },
      });
      expect(conditions).toContainEqual({
        contacts: {
          some: {
            tenantId: TENANT_ID,
            name: { contains: 'solar\\.\\*', mode: 'insensitive' },
          },
        },
      });
      expect(conditions).toContainEqual({
        contacts: {
          some: {
            tenantId: TENANT_ID,
            email: { contains: 'solar\\.\\*', mode: 'insensitive' },
          },
        },
      });
    });

    it('busca por documento e telefone com os dígitos do termo', () => {
      const conditions = orConditions(where({ q: '33.456.789/0001-02' }));

      expect(conditions).toContainEqual({
        cnpj: { contains: '33456789000102' },
      });
      expect(conditions).toContainEqual({
        cpf: { contains: '33456789000102' },
      });
      expect(conditions).toContainEqual({
        contacts: {
          some: { tenantId: TENANT_ID, phone: { contains: '33456789000102' } },
        },
      });
    });

    it('não busca por documento quando o termo tem menos de 3 dígitos', () => {
      const conditions = orConditions(where({ q: 'solar 12' }));

      expect(conditions.some((condition) => 'cnpj' in condition)).toBe(false);
      expect(conditions.some((condition) => 'cpf' in condition)).toBe(false);
    });

    it('termo vazio ou em branco não filtra', () => {
      expect(orConditions(where({ q: '   ' }))).toEqual([]);
      expect(orConditions(where({}))).toEqual([]);
    });

    it('combina filtros de empresa com AND, sem conflitar os ORs', () => {
      const conditions = leadConditions(
        where({ uf: 'MG', temperature: 'hot', q: 'solar' }),
      );

      expect(conditions).toContainEqual({ state: 'MG' });
      // Dois blocos `OR` independentes: temperatura e busca não se misturam.
      expect(
        conditions.filter((condition) => Array.isArray(condition.OR)),
      ).toHaveLength(2);
    });
  });

  it('ordena por último contato (nulos por último) e depois por cadastro recente', () => {
    expect(POOL_ORDER_BY).toEqual([
      { lastContactAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
    ]);
  });

  it('não deixa page/limit entrarem no where — a paginação é aplicada pelo serviço', () => {
    const paginated = buildPoolWhere({ page: 3, limit: 50 }, TENANT_ID);

    expect(paginated).toEqual(where({}));
    expect(paginated).not.toHaveProperty('skip');
    expect(paginated).not.toHaveProperty('take');
  });

  it('só considera captável o lead AVAILABLE ou RETURNED_TO_POOL', () => {
    expect(CLAIMABLE_STATUSES).toEqual(['AVAILABLE', 'RETURNED_TO_POOL']);
  });
});

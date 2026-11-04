import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '../common/auth/auth.types.js';
import { ExportQueryDto } from './dto/export-query.dto.js';
import { buildExportWhere as buildExportWhereRaw } from './export.query.js';

/**
 * Testes do `where` da exportação (`GET /leads/export`).
 *
 * Duas coisas precisam ser provadas aqui: a visibilidade (vendedor só exporta a
 * própria carteira) e o isolamento por tenant na busca por contato — a
 * regressão que vazava telefone/e-mail de outra corporação.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const OTHER_SELLER = '33333333-3333-4333-8333-333333333333';

/** Quinta-feira, 15/10/2026 — o `now` fixo do recorte de período. */
const NOW = new Date(2026, 9, 15, 12, 0, 0);

function user(
  operationalRole: AuthUser['operationalRole'],
  userId = ME,
): AuthUser {
  return {
    userId,
    tenantId: TENANT,
    sessionId: 'sess',
    role: operationalRole === 'ADMIN' ? 'ADMIN' : 'USUARIO',
    operationalRole,
  };
}

/** Condições do `AND` externo do `where`. */
function conditions(where: Record<string, unknown>): Record<string, unknown>[] {
  return where.AND as Record<string, unknown>[];
}

/**
 * `buildExportWhere` com o `format` padrão do DTO já preenchido.
 *
 * O DTO declara `format = 'csv'` como valor inicial (o `ValidationPipe` sempre
 * instancia a classe), então os testes passam só os filtros que interessam.
 */
function buildExportWhere(
  authUser: AuthUser,
  query: Partial<ExportQueryDto>,
  now: Date,
): Record<string, unknown> {
  return buildExportWhereRaw(
    authUser,
    { format: 'csv', ...query } as ExportQueryDto,
    now,
  );
}

/** Primeira condição que tem a chave pedida (ou `undefined`). */
function conditionWith(
  where: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return conditions(where).find((condition) => key in condition);
}

/** Filtro do `Lead` (o que a exportação aplica via `lead.is`). */
function leadConditions(where: Record<string, unknown>): Record<string, unknown>[] {
  const lead = conditionWith(where, 'lead') as
    | { lead: { is: { AND: Record<string, unknown>[] } } }
    | undefined;

  return lead?.lead.is.AND ?? [];
}

/** Condições de busca textual (`contacts`/`cnpj`/`cpf`). */
function searchConditions(where: Record<string, unknown>): Record<string, unknown>[] {
  const search = leadConditions(where).find((condition) => 'OR' in condition) as
    | { OR: Record<string, unknown>[] }
    | undefined;

  return search?.OR ?? [];
}

describe('buildExportWhere — visibilidade do responsável', () => {
  it('VENDEDOR sempre filtra pela própria carteira, mesmo pedindo `all` @spec:AC-130', () => {
    const where = buildExportWhere(user('VENDEDOR'), { assigned_user_id: 'all' }, NOW);

    expect(conditionWith(where, 'assignedUserId')).toEqual({ assignedUserId: ME });
  });

  it('VENDEDOR ignora o UUID de outro vendedor', () => {
    const where = buildExportWhere(
      user('VENDEDOR'),
      { assigned_user_id: OTHER_SELLER },
      NOW,
    );

    expect(conditionWith(where, 'assignedUserId')).toEqual({ assignedUserId: ME });
    expect(JSON.stringify(where)).not.toContain(OTHER_SELLER);
  });

  it('VENDEDOR exporta a própria carteira quando pede `me`', () => {
    const where = buildExportWhere(user('VENDEDOR'), { assigned_user_id: 'me' }, NOW);

    expect(conditionWith(where, 'assignedUserId')).toEqual({ assignedUserId: ME });
  });

  it('ADMIN com `all` (ou sem o parâmetro) não recorta responsável', () => {
    expect(conditionWith(buildExportWhere(user('ADMIN'), {}, NOW), 'assignedUserId')).toBeUndefined();
    expect(
      conditionWith(
        buildExportWhere(user('ADMIN'), { assigned_user_id: 'all' }, NOW),
        'assignedUserId',
      ),
    ).toBeUndefined();
  });

  it('ADMIN com `me` exporta só o que é dele', () => {
    const where = buildExportWhere(user('ADMIN'), { assigned_user_id: 'me' }, NOW);

    expect(conditionWith(where, 'assignedUserId')).toEqual({ assignedUserId: ME });
  });

  it('ADMIN e CAPTADOR honram o UUID de um vendedor', () => {
    for (const role of ['ADMIN', 'CAPTADOR'] as const) {
      const where = buildExportWhere(
        user(role),
        { assigned_user_id: OTHER_SELLER },
        NOW,
      );

      expect(conditionWith(where, 'assignedUserId')).toEqual({
        assignedUserId: OTHER_SELLER,
      });
    }
  });

  it('CAPTADOR com `all` vê o tenant inteiro', () => {
    const where = buildExportWhere(user('CAPTADOR'), { assigned_user_id: 'all' }, NOW);

    expect(conditionWith(where, 'assignedUserId')).toBeUndefined();
  });
});

describe('buildExportWhere — isolamento por tenant', () => {
  it('sempre filtra o tenant da sessão', () => {
    for (const role of ['ADMIN', 'CAPTADOR', 'VENDEDOR'] as const) {
      const where = buildExportWhere(user(role), {}, NOW);

      expect(conditions(where)[0]).toEqual({ tenantId: TENANT });
    }
  });

  it('a busca por contato filtra o tenant (regressão de vazamento cross-tenant) @spec:AC-132', () => {
    const where = buildExportWhere(user('ADMIN'), { q: 'maria' }, NOW);
    const contacts = searchConditions(where).filter((condition) => 'contacts' in condition);

    expect(contacts).toHaveLength(2);

    for (const condition of contacts) {
      expect((condition.contacts as { some: Record<string, unknown> }).some.tenantId).toBe(
        TENANT,
      );
    }
  });

  it('a busca por telefone também escopa o contato pelo tenant', () => {
    const where = buildExportWhere(user('VENDEDOR'), { q: '(31) 99999-0000' }, NOW);
    const phone = searchConditions(where).find(
      (condition) =>
        'contacts' in condition &&
        'phone' in (condition.contacts as { some: Record<string, unknown> }).some,
    );

    expect(phone).toBeDefined();
    expect((phone!.contacts as { some: Record<string, unknown> }).some).toMatchObject({
      tenantId: TENANT,
      phone: { contains: '31999990000' },
    });
  });

  it('a busca por documento procura pelos dígitos', () => {
    const where = buildExportWhere(user('ADMIN'), { q: '33.456.789/0001-02' }, NOW);
    const keys = searchConditions(where).flatMap((condition) => Object.keys(condition));

    expect(keys).toContain('cnpj');
    expect(keys).toContain('cpf');
    expect(JSON.stringify(searchConditions(where))).toContain('33456789000102');
  });

  it('busca curta (menos de 3 dígitos) não procura documento/telefone', () => {
    const where = buildExportWhere(user('ADMIN'), { q: '12' }, NOW);
    const keys = searchConditions(where).flatMap((condition) => Object.keys(condition));

    expect(keys).not.toContain('cnpj');
    expect(keys).not.toContain('cpf');
  });

  it('`q` vazio não cria condição de busca', () => {
    const where = buildExportWhere(user('ADMIN'), { q: '   ' }, NOW);

    expect(searchConditions(where)).toHaveLength(0);
  });
});

describe('buildExportWhere — filtros da tela', () => {
  it('recorta o período em `createdAt` (fechado nas duas pontas)', () => {
    const where = buildExportWhere(
      user('ADMIN'),
      { period: 'custom', start_date: '2026-10-01', end_date: '2026-10-31' },
      NOW,
    );
    const createdAt = conditionWith(where, 'createdAt') as {
      createdAt: { gte: Date; lte: Date };
    };

    expect(createdAt.createdAt.gte).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(createdAt.createdAt.lte).toEqual(new Date(2026, 9, 31, 23, 59, 59, 999));
  });

  it('sem `period` usa o mês corrente', () => {
    const where = buildExportWhere(user('ADMIN'), {}, NOW);
    const createdAt = conditionWith(where, 'createdAt') as {
      createdAt: { gte: Date; lte: Date };
    };

    expect(createdAt.createdAt.gte).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(createdAt.createdAt.lte).toEqual(new Date(2026, 9, 31, 23, 59, 59, 999));
  });

  it('recusa `custom` sem as datas com 400 VALIDATION_ERROR', () => {
    expect(() => buildExportWhere(user('ADMIN'), { period: 'custom' }, NOW)).toThrow(
      /exige `start_date` e `end_date`/,
    );
  });

  it('aplica a faixa de ticket', () => {
    const where = buildExportWhere(
      user('ADMIN'),
      { ticket_min: 1_000, ticket_max: 5_000 },
      NOW,
    );

    expect(conditionWith(where, 'ticketValue')).toEqual({
      ticketValue: { gte: 1_000, lte: 5_000 },
    });
  });

  it('aplica só o limite informado da faixa de ticket', () => {
    expect(
      conditionWith(buildExportWhere(user('ADMIN'), { ticket_min: 1_000 }, NOW), 'ticketValue'),
    ).toEqual({ ticketValue: { gte: 1_000 } });

    expect(
      conditionWith(buildExportWhere(user('ADMIN'), { ticket_max: 5_000 }, NOW), 'ticketValue'),
    ).toEqual({ ticketValue: { lte: 5_000 } });
  });

  it('não filtra ticket quando a faixa não foi enviada', () => {
    expect(
      conditionWith(buildExportWhere(user('ADMIN'), {}, NOW), 'ticketValue'),
    ).toBeUndefined();
  });

  it('filtra pela etapa pelo `code` e ignora `all`', () => {
    expect(
      conditionWith(buildExportWhere(user('ADMIN'), { stage: '4_proposta' }, NOW), 'stage'),
    ).toEqual({ stage: { code: '4_proposta' } });

    expect(
      conditionWith(buildExportWhere(user('ADMIN'), { stage: 'all' }, NOW), 'stage'),
    ).toBeUndefined();
  });

  it('filtra UF, setor, porte e temperatura @spec:AC-131', () => {
    const where = buildExportWhere(
      user('ADMIN'),
      { uf: 'MG', sector: 'solar', company_size: 'ME', temperature: 'hot' },
      NOW,
    );
    const lead = leadConditions(where);

    expect(lead).toContainEqual({ state: 'MG' });
    expect(lead).toContainEqual({ sector: 'SOLAR' });
    expect(lead).toContainEqual({ companySize: 'ME' });
    expect(lead).toContainEqual({
      OR: [{ temperature: 'QUENTE' }, { temperatureScore: { gte: 80 } }],
    });
  });

  it('`ALL`/`all` desligam os filtros de UF, setor e porte', () => {
    const where = buildExportWhere(
      user('ADMIN'),
      { uf: 'ALL', sector: 'all', company_size: 'ALL' },
      NOW,
    );

    expect(leadConditions(where)).toEqual([]);
  });

  it('temperatura morna e fria combinam rótulo e score', () => {
    expect(leadConditions(buildExportWhere(user('ADMIN'), { temperature: 'warm' }, NOW))).toEqual([
      { OR: [{ temperature: 'MORNO' }, { temperatureScore: { gte: 50, lte: 79 } }] },
    ]);
    expect(leadConditions(buildExportWhere(user('ADMIN'), { temperature: 'frio' }, NOW))).toEqual([
      { OR: [{ temperature: 'FRIO' }, { temperatureScore: { lt: 50 } }] },
    ]);
  });
});

describe('ExportQueryDto — validação da faixa de ticket', () => {
  /** Mensagens de erro da validação do DTO (o que o `ValidationPipe` devolve). */
  async function validateQuery(raw: Record<string, unknown>): Promise<string[]> {
    const errors = await validate(plainToInstance(ExportQueryDto, raw));

    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  }

  it('`ticket_min > ticket_max` é erro de validação (400)', async () => {
    const messages = await validateQuery({ ticket_min: '100', ticket_max: '50' });

    expect(messages).toContain('`ticket_min` não pode ser maior que `ticket_max`.');
  });

  it('faixa válida passa', async () => {
    await expect(validateQuery({ ticket_min: '100', ticket_max: '500' })).resolves.toEqual([]);
  });

  it('faixa com só uma ponta passa', async () => {
    await expect(validateQuery({ ticket_min: '100' })).resolves.toEqual([]);
    await expect(validateQuery({ ticket_max: '100' })).resolves.toEqual([]);
  });

  it('aceita `me`/`all` no responsável e exige UUID nos demais valores', async () => {
    await expect(validateQuery({ assigned_user_id: 'me' })).resolves.toEqual([]);
    await expect(validateQuery({ assigned_user_id: 'all' })).resolves.toEqual([]);
    await expect(validateQuery({ assigned_user_id: ME })).resolves.toEqual([]);
    expect(await validateQuery({ assigned_user_id: 'nao-e-uuid' })).not.toEqual([]);
  });
});

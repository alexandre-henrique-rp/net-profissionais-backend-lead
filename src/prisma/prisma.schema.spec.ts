import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CompanySize,
  LeadSpecialDateType,
  LeadTemperature,
  LeadTimelineNoteType,
  OperationalRole,
  PersonType,
  TenantLeadStatus,
  TenantSector,
  UserRole,
  UserStatus,
} from '../generated/prisma/enums.js';

const schemaPath = fileURLToPath(
  new URL('../../prisma/schema.prisma', import.meta.url),
);
const migrationPath = fileURLToPath(
  new URL(
    '../../prisma/migrations/0_init_mvp_schema/migration.sql',
    import.meta.url,
  ),
);

const schema = readFileSync(schemaPath, 'utf-8');
const migration = readFileSync(migrationPath, 'utf-8');

const MODELOS_MVP = [
  'Tenant',
  'User',
  'Stage',
  'Lead',
  'TenantLead',
  'LeadContact',
  'LeadSpecialDate',
  'LeadTimelineNote',
];

const blocoDoSchema = (nome: string): string => {
  const inicio = schema.indexOf(`model ${nome} {`);
  if (inicio === -1) return '';
  const fim = schema.indexOf('\n}', inicio);
  return schema.slice(inicio, fim);
};

describe('schema Prisma do MVP', () => {
  it('declara os 8 modelos do MVP @spec:AC-004', () => {
    const declarados = [...schema.matchAll(/^model (\w+) \{/gm)].map(
      (match) => match[1],
    );

    expect(declarados.sort()).toEqual([...MODELOS_MVP].sort());
  });

  it('gera no cliente os enums de domínio com os valores esperados @spec:AC-004', () => {
    expect(UserRole).toEqual({ ADMIN: 'ADMIN', USUARIO: 'USUARIO' });
    expect(OperationalRole).toEqual({
      ADMIN: 'ADMIN',
      CAPTADOR: 'CAPTADOR',
      VENDEDOR: 'VENDEDOR',
    });
    expect(UserStatus).toEqual({
      ACTIVE: 'ACTIVE',
      PENDING: 'PENDING',
      BLOCKED: 'BLOCKED',
    });
    expect(PersonType).toEqual({ PJ: 'PJ', PF: 'PF' });
    expect(TenantLeadStatus).toEqual({
      AVAILABLE: 'AVAILABLE',
      CLAIMED: 'CLAIMED',
      RETURNED_TO_POOL: 'RETURNED_TO_POOL',
      LOST: 'LOST',
    });
    expect(TenantSector).toEqual({
      SOLAR: 'SOLAR',
      TECNOLOGIA: 'TECNOLOGIA',
      CONSTRUCAO: 'CONSTRUCAO',
      SERVICOS: 'SERVICOS',
      OUTROS: 'OUTROS',
      AGROPECUARIA: 'AGROPECUARIA',
      EXTRATIVISMO: 'EXTRATIVISMO',
      INDUSTRIA: 'INDUSTRIA',
      ENERGIA: 'ENERGIA',
      AGUA_RESIDUOS: 'AGUA_RESIDUOS',
      COMERCIO: 'COMERCIO',
      TRANSPORTE_LOGISTICA: 'TRANSPORTE_LOGISTICA',
      ALOJAMENTO_ALIMENTACAO: 'ALOJAMENTO_ALIMENTACAO',
      INFORMACAO_COMUNICACAO: 'INFORMACAO_COMUNICACAO',
      FINANCAS_SEGUROS: 'FINANCAS_SEGUROS',
      IMOBILIARIO: 'IMOBILIARIO',
      PROFISSIONAL_CIENTIFICO: 'PROFISSIONAL_CIENTIFICO',
      ADMINISTRATIVO: 'ADMINISTRATIVO',
      ADMINISTRACAO_PUBLICA: 'ADMINISTRACAO_PUBLICA',
      EDUCACAO: 'EDUCACAO',
      SAUDE_SOCIAL: 'SAUDE_SOCIAL',
      ARTES_LAZER: 'ARTES_LAZER',
      SERVICOS_DOMESTICOS: 'SERVICOS_DOMESTICOS',
      ORGANISMOS_INTERNACIONAIS: 'ORGANISMOS_INTERNACIONAIS',
    });
    expect(CompanySize).toEqual({ ME: 'ME', EPP: 'EPP', DEMAIS: 'DEMAIS' });
    expect(LeadTemperature).toEqual({
      QUENTE: 'QUENTE',
      MORNO: 'MORNO',
      FRIO: 'FRIO',
    });
    expect(LeadTimelineNoteType).toEqual({
      NOTE: 'NOTE',
      CALL: 'CALL',
      MEETING: 'MEETING',
      STATUS_CHANGE: 'STATUS_CHANGE',
    });
    expect(LeadSpecialDateType).toEqual({
      ANIVERSARIO_SOCIO: 'ANIVERSARIO_SOCIO',
      ANIVERSARIO_EMPRESA: 'ANIVERSARIO_EMPRESA',
    });
  });

  it('garante o token de webhook único por tenant @spec:AC-006', () => {
    expect(blocoDoSchema('Tenant')).toMatch(/webhookToken\s+String\s+@unique/);
  });

  it('impede duplicar a mesma oportunidade no mesmo tenant @spec:AC-006', () => {
    expect(blocoDoSchema('TenantLead')).toMatch(
      /@@unique\(\[tenantId, leadId\]\)/,
    );
  });

  it('mantém a versão de concorrência otimista com padrão 1 @spec:AC-006', () => {
    expect(blocoDoSchema('TenantLead')).toMatch(
      /version\s+Int\s+@default\(1\)/,
    );
  });

  it('indexa o e-mail por tenant e o documento do lead @spec:AC-006', () => {
    expect(blocoDoSchema('User')).toMatch(/@@unique\(\[tenantId, email\]\)/);
    // A identidade do cliente é global e única por documento: `@unique` cobre
    // a busca e é o que permite o `upsert` atômico do cadastro manual/webhook.
    expect(blocoDoSchema('Lead')).toMatch(/cnpj\s+String\?\s+@unique/);
    expect(blocoDoSchema('Lead')).toMatch(/cpf\s+String\?\s+@unique/);
  });

  it('gera a migration inicial com as 8 tabelas @spec:AC-005', () => {
    const tabelas = [...migration.matchAll(/^CREATE TABLE "([^"]+)"/gm)].map(
      (match) => match[1],
    );

    expect(tabelas.sort()).toEqual([...MODELOS_MVP].sort());
  });

  it('mantém o schema e a migração em sincronia @spec:AC-005', () => {
    const tabelasDoSchema = [...schema.matchAll(/^model (\w+) \{/gm)].map(
      (match) => match[1],
    );
    const tabelasDaMigration = [
      ...migration.matchAll(/^CREATE TABLE "([^"]+)"/gm),
    ].map((match) => match[1]);

    expect(tabelasDoSchema.sort()).toEqual(tabelasDaMigration.sort());
  });
});

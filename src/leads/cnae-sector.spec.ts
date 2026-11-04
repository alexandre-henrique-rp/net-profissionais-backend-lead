import { TenantSector } from '../generated/prisma/client.js';
import { deriveSectorFromCnae } from './cnae-sector.js';

describe('deriveSectorFromCnae', () => {
  it.each([
    ['0101501', TenantSector.AGROPECUARIA],
    ['0510100', TenantSector.EXTRATIVISMO],
    ['1011201', TenantSector.INDUSTRIA],
    ['3511500', TenantSector.ENERGIA],
    ['3600601', TenantSector.AGUA_RESIDUOS],
    ['4321500', TenantSector.CONSTRUCAO],
    ['4711301', TenantSector.COMERCIO],
    ['4930201', TenantSector.TRANSPORTE_LOGISTICA],
    ['5611201', TenantSector.ALOJAMENTO_ALIMENTACAO],
    ['6201500', TenantSector.INFORMACAO_COMUNICACAO],
    ['6410700', TenantSector.FINANCAS_SEGUROS],
    ['6810201', TenantSector.IMOBILIARIO],
    ['6911701', TenantSector.PROFISSIONAL_CIENTIFICO],
    ['7711000', TenantSector.ADMINISTRATIVO],
    ['8411600', TenantSector.ADMINISTRACAO_PUBLICA],
    ['8511200', TenantSector.EDUCACAO],
    ['8610101', TenantSector.SAUDE_SOCIAL],
    ['9001901', TenantSector.ARTES_LAZER],
    ['9491000', TenantSector.SERVICOS],
    ['9700500', TenantSector.SERVICOS_DOMESTICOS],
    ['9900800', TenantSector.ORGANISMOS_INTERNACIONAIS],
  ])('classifica CNAE %s pela divisão oficial @spec:AC-180', (cnae, sector) => {
    expect(deriveSectorFromCnae(cnae)).toBe(sector);
  });

  it('aceita código numérico sem o zero à esquerda e formatação', () => {
    expect(deriveSectorFromCnae(101501)).toBe(TenantSector.AGROPECUARIA);
    expect(deriveSectorFromCnae('43.21-5/00')).toBe(TenantSector.CONSTRUCAO);
  });

  it.each([null, undefined, '', '00', '04.10-0/00'])(
    'classifica CNAE ausente ou desconhecido como OUTROS (%s)',
    (cnae) => {
      expect(deriveSectorFromCnae(cnae)).toBe(TenantSector.OUTROS);
    },
  );
});

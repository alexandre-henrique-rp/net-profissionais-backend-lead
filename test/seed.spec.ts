import { SEED_ADMIN, SEED_STAGES, SEED_TENANT } from '../prisma/seed.js';

describe('seed do MVP', () => {
  it('provisiona o tenant NetProfissional com o id fixo do produto @spec:AC-007', () => {
    expect(SEED_TENANT.id).toBe('1209f89d-8328-80f5-8008-d08667c53da5');
    expect(SEED_TENANT.name).toBe('NetProfissional Tecnologia');
  });

  it('cria as 7 etapas comerciais na ordem do funil @spec:AC-007', () => {
    expect(SEED_STAGES).toHaveLength(7);
    expect(SEED_STAGES.map((stage) => stage.code)).toEqual([
      '1_novo_lead',
      '2_qualificacao',
      '3_apresentacao',
      '4_proposta',
      '5_negociacao',
      '6_fechado_ganho',
      '7_perdido',
    ]);
  });

  it('marca apenas a etapa Perdido como etapa de perda @spec:AC-007', () => {
    const etapasDePerda = SEED_STAGES.filter((stage) => stage.code === '7_perdido');

    expect(etapasDePerda).toHaveLength(1);
  });

  it('cria o administrador inicial com o e-mail do produto @spec:AC-007', () => {
    expect(SEED_ADMIN.email).toBe('carlos.admin@netprofissional.com.br');
  });
});

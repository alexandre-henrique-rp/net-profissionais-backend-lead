import { isLostStageLike, lostStageIds, wonStageIds, type StageLike } from './stages.js';

/**
 * Testes da classificação de etapas do funil.
 *
 * A regra é derivada do catálogo do tenant: código de ganho manda; o fallback
 * "última posição" só vale quando existe um funil de verdade (etapa de perda e
 * mais de uma etapa).
 */

function stage(
  id: string,
  code: string,
  position: number,
  isLostStage = false,
): StageLike {
  return { id, code, position, isLostStage };
}

/** Catálogo do seed: 7 etapas, ganho em `6_fechado_ganho`, perda em `7_perdido`. */
const SEED_STAGES: StageLike[] = [
  stage('s1', '1_novo', 1),
  stage('s2', '2_contato_inicial', 2),
  stage('s3', '3_qualificado', 3),
  stage('s4', '4_proposta', 4),
  stage('s5', '5_negociacao', 5),
  stage('s6', '6_fechado_ganho', 6),
  stage('s7', '7_perdido', 7, true),
];

describe('wonStageIds', () => {
  it('usa o código `fechado_ganho` como fonte de verdade', () => {
    expect([...wonStageIds(SEED_STAGES)]).toEqual(['s6']);
  });

  it('reconhece o código `ganho` (catálogo renomeado)', () => {
    const stages = [
      stage('a', '1_entrada', 1),
      stage('b', '2_ganho', 2),
      stage('c', '3_perdido', 3, true),
    ];

    expect([...wonStageIds(stages)]).toEqual(['b']);
  });

  it('ignora etapa de ganho marcada como perda', () => {
    const stages = [
      stage('a', '1_entrada', 1),
      stage('b', '2_fechado_ganho', 2, true),
      stage('c', '3_perdido', 3, true),
    ];

    expect(wonStageIds(stages).size).toBe(0);
  });

  it('usa o fallback da maior `position` quando não há código de ganho', () => {
    const stages = [
      stage('a', '1_entrada', 1),
      stage('b', '2_proposta', 2),
      stage('c', '3_perdido', 3, true),
    ];

    expect([...wonStageIds(stages)]).toEqual(['b']);
  });

  it('não usa o fallback sem etapa de perda', () => {
    const stages = [stage('a', '1_entrada', 1), stage('b', '2_proposta', 2)];

    expect(wonStageIds(stages).size).toBe(0);
  });

  it('tenant com uma única etapa não classifica tudo como ganho', () => {
    expect(wonStageIds([stage('a', '1_novo', 1)]).size).toBe(0);
    // Nem quando essa única etapa é a de perda.
    expect(wonStageIds([stage('a', '1_perdido', 1, true)]).size).toBe(0);
  });

  it('não adivinha em catálogo ambíguo (duas etapas empatadas na maior posição)', () => {
    const stages = [
      stage('a', '1_entrada', 1),
      stage('b', '2_proposta', 2),
      stage('c', '2_negociacao', 2),
      stage('d', '3_perdido', 3, true),
    ];

    expect(wonStageIds(stages).size).toBe(0);
  });

  it('não classifica como ganho um tenant só com etapas de perda', () => {
    const stages = [stage('a', '1_perdido', 1, true), stage('b', '2_cancelado', 2, true)];

    expect(wonStageIds(stages).size).toBe(0);
  });

  it('prefere o código mesmo quando a etapa não é a última posição', () => {
    const stages = [
      stage('a', '1_novo', 1),
      stage('b', '2_ganho', 2),
      stage('c', '3_pos_venda', 3),
      stage('d', '4_perdido', 4, true),
    ];

    expect([...wonStageIds(stages)]).toEqual(['b']);
  });

  it('devolve conjunto vazio para catálogo vazio', () => {
    expect(wonStageIds([]).size).toBe(0);
  });
});

describe('lostStageIds e isLostStageLike', () => {
  it('acha a etapa pela flag', () => {
    expect([...lostStageIds(SEED_STAGES)]).toEqual(['s7']);
  });

  it('usa o código `perdido` quando a flag não foi preenchida', () => {
    const stages = [
      stage('a', '1_novo', 1),
      stage('b', '2_perdido', 2),
      stage('c', '3_ganho', 3),
    ];

    expect([...lostStageIds(stages)]).toEqual(['b']);
    expect(isLostStageLike(stage('x', 'QUALQUER', 1, true))).toBe(true);
    expect(isLostStageLike(stage('y', 'PERDIDO', 1, false))).toBe(true);
    expect(isLostStageLike(stage('z', '2_proposta', 2))).toBe(false);
  });
});

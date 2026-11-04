/**
 * Classificação das etapas do funil: quais contam como ganho e quais como perda.
 *
 * A regra é derivada do catálogo do tenant (`Stage`), não fixada em código: o
 * tenant do seed tem `6_fechado_ganho` e `7_perdido`, mas um tenant com etapas
 * renomeadas continua funcionando.
 */

/** O mínimo que a classificação precisa de uma `Stage`. */
export interface StageLike {
  id: string;
  code: string;
  position: number;
  isLostStage: boolean;
}

/** Trechos de código que identificam a etapa de ganho. */
const WON_CODE_FRAGMENTS = ['fechado_ganho', 'ganho'] as const;

/** Trecho de código que identifica a etapa de perda quando a flag falta. */
const LOST_CODE_FRAGMENT = 'perdido';

/**
 * Etapa de perda: a flag `isLostStage` manda; o código (`*perdido`) é só o
 * fallback para catálogo antigo que não preencheu a flag.
 */
export function isLostStageLike(stage: StageLike): boolean {
  return stage.isLostStage || stage.code.toLowerCase().includes(LOST_CODE_FRAGMENT);
}

/** A etapa tem código de ganho (`fechado_ganho`, `ganho`…)? */
function isWonStageCode(stage: StageLike): boolean {
  const code = stage.code.toLowerCase();

  return WON_CODE_FRAGMENTS.some((fragment) => code.includes(fragment));
}

/**
 * Conjunto de etapas que contam como ganho.
 *
 * Critério (documentado como decisão de produto do módulo):
 * 1. **Sempre** o código manda: toda etapa cujo `code` contenha `fechado_ganho`
 *    ou `ganho`;
 * 2. só na ausência total de código de ganho no catálogo — inclusive quando a
 *    etapa com esse código foi marcada como perda, o que é configuração
 *    contraditória —, a etapa não-perdida de maior `position` — e apenas se o
 *    tenant **tiver** etapa de perda e mais de uma etapa (ou seja, existe um
 *    funil de verdade e a última coluna antes da perda é o fechamento).
 *
 * O fallback antigo classificava qualquer tenant como ganho: um tenant com a
 * única etapa `1_novo` tinha 100% de conversão, e um tenant sem
 * `fechado_ganho` contava `3_proposta` como venda. Em catálogo ambíguo (duas
 * etapas empatadas na maior `position`) não há como decidir: devolve vazio em
 * vez de adivinhar.
 */
export function wonStageIds(stages: readonly StageLike[]): Set<string> {
  const candidates = stages.filter((stage) => !isLostStageLike(stage));

  const explicit = candidates.filter(isWonStageCode);

  if (explicit.length > 0) {
    return new Set(explicit.map((stage) => stage.id));
  }

  const hasLostStage = stages.some(isLostStageLike);
  /**
   * O catálogo **declara** uma etapa de ganho, mas ela foi marcada como perda
   * (configuração contraditória). Nesse caso não há fallback: adivinhar a
   * "última etapa" faria um lead em `2_contato` contar como venda. Devolver
   * vazio é a resposta honesta — o tenant precisa corrigir o catálogo.
   */
  const declaresWonStage = stages.some(isWonStageCode);

  if (declaresWonStage || !hasLostStage || stages.length <= 1 || candidates.length === 0) {
    return new Set<string>();
  }

  const lastPosition = Math.max(...candidates.map((stage) => stage.position));
  const lastStages = candidates.filter((stage) => stage.position === lastPosition);

  if (lastStages.length !== 1) {
    return new Set<string>();
  }

  return new Set(lastStages.map((stage) => stage.id));
}

/** Conjunto de etapas de perda do tenant. */
export function lostStageIds(stages: readonly StageLike[]): Set<string> {
  return new Set(
    stages.filter((stage) => isLostStageLike(stage)).map((stage) => stage.id),
  );
}

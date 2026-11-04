import { formatDay } from './period.js';
import { isStagnant } from './metrics.js';

/**
 * Tarefas do dia do Vendedor (`02-B-D`).
 *
 * A regra é pura para poder ser exercitada sem banco: dado um lead e um
 * instante de referência, devolve o texto que o card da agenda exibe.
 */

/** Texto base do alerta de inatividade (mesma frase usada no funil). */
export const INACTIVITY_REASON = 'Sem contato há mais de 48h';

/** Texto exibido quando nada dispara alerta (defensivo, não deveria ocorrer). */
const FALLBACK_REASON = 'Acompanhamento pendente';

/** Campos do lead que alimentam a decisão. */
export interface TaskSignals {
  lastContactAt: Date | null;
  expectedCloseDate: Date | null;
}

/** Compara apenas a parte da data (dia local), ignorando a hora. */
function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Um lead entra na agenda do dia quando a previsão de fechamento vence hoje
 * (ou já venceu) ou quando está parado há mais de 48 horas.
 */
export function isTodayTask(signals: TaskSignals, now: Date): boolean {
  const today = dayStart(now);
  const closeDate = signals.expectedCloseDate
    ? dayStart(signals.expectedCloseDate)
    : null;

  return (
    (closeDate !== null && closeDate <= today) ||
    isStagnant(signals.lastContactAt, now.getTime())
  );
}

/**
 * Motivo exibido no card — derivado **do que realmente disparou a tarefa**.
 *
 * Antes esta função escrevia "Previsão de fechamento para hoje" para qualquer
 * data futura: um lead com previsão em 31/12 entrava na agenda só por
 * inatividade e o card mentia sobre a previsão. Agora:
 * - previsão vencida (`< hoje`) → "vencida" com a data;
 * - previsão de hoje (`=== hoje`) → "para hoje";
 * - previsão futura → **nenhum** motivo de previsão (ela não é o gatilho);
 * - inatividade (`> 48h` sem contato) → motivo próprio.
 *
 * Quando previsão e inatividade coexistem, a previsão vem primeiro (mais
 * urgente) e a inatividade é mencionada em seguida.
 */
export function buildTaskReason(signals: TaskSignals, now: Date): string {
  const reasons: string[] = [];
  const today = dayStart(now);
  const closeDate = signals.expectedCloseDate
    ? dayStart(signals.expectedCloseDate)
    : null;

  if (closeDate !== null && closeDate < today) {
    reasons.push(`Previsão de fechamento vencida (${formatDay(signals.expectedCloseDate as Date)})`);
  } else if (closeDate !== null && closeDate === today) {
    reasons.push('Previsão de fechamento para hoje');
  }

  if (isStagnant(signals.lastContactAt, now.getTime())) {
    reasons.push(INACTIVITY_REASON);
  }

  return reasons.length > 0 ? reasons.join(' · ') : FALLBACK_REASON;
}

import { INACTIVITY_REASON, buildTaskReason, isTodayTask } from './tasks.js';

/**
 * Testes da agenda do dia do Vendedor (`02-B-D`).
 *
 * A regra é pura: o lead e o instante de referência entram por parâmetro.
 */

/** Sexta-feira, 28/10/2026, 12:00 no fuso do servidor. */
const NOW = new Date(2026, 9, 28, 12, 0, 0);

const HOUR = 60 * 60 * 1000;

/** Contato recente (não dispara inatividade). */
const RECENT_CONTACT = new Date(NOW.getTime() - 2 * HOUR);

/** Contato antigo (mais de 48h). */
const OLD_CONTACT = new Date(NOW.getTime() - 49 * HOUR);

describe('isTodayTask', () => {
  it('entra na agenda quando a previsão de fechamento já venceu', () => {
    expect(
      isTodayTask(
        { lastContactAt: RECENT_CONTACT, expectedCloseDate: new Date(2026, 9, 20) },
        NOW,
      ),
    ).toBe(true);
  });

  it('entra na agenda quando a previsão de fechamento é hoje', () => {
    expect(
      isTodayTask(
        { lastContactAt: RECENT_CONTACT, expectedCloseDate: new Date(2026, 9, 28, 23, 0, 0) },
        NOW,
      ),
    ).toBe(true);
  });

  it('não entra por previsão futura, mas entra por inatividade > 48h', () => {
    expect(
      isTodayTask(
        { lastContactAt: RECENT_CONTACT, expectedCloseDate: new Date(2026, 11, 31) },
        NOW,
      ),
    ).toBe(false);

    expect(isTodayTask({ lastContactAt: OLD_CONTACT, expectedCloseDate: null }, NOW)).toBe(
      true,
    );
  });

  it('nunca contatado conta como parado', () => {
    expect(isTodayTask({ lastContactAt: null, expectedCloseDate: null }, NOW)).toBe(true);
  });

  it('lead com contato recente e sem previsão fica fora da agenda', () => {
    expect(
      isTodayTask({ lastContactAt: RECENT_CONTACT, expectedCloseDate: null }, NOW),
    ).toBe(false);
  });
});

describe('buildTaskReason', () => {
  it('descreve previsão vencida com a data', () => {
    const reason = buildTaskReason(
      { lastContactAt: RECENT_CONTACT, expectedCloseDate: new Date(2026, 9, 20) },
      NOW,
    );

    expect(reason).toContain('vencida');
    expect(reason).toContain('20/10/2026');
    expect(reason).not.toContain(INACTIVITY_REASON);
  });

  it('descreve previsão de hoje', () => {
    const reason = buildTaskReason(
      { lastContactAt: RECENT_CONTACT, expectedCloseDate: new Date(2026, 9, 28) },
      NOW,
    );

    expect(reason).toBe('Previsão de fechamento para hoje');
  });

  it('previsão futura nunca gera motivo de previsão', () => {
    const soFuturo = buildTaskReason(
      { lastContactAt: RECENT_CONTACT, expectedCloseDate: new Date(2026, 11, 31) },
      NOW,
    );

    expect(soFuturo).not.toContain('Previsão');
    expect(soFuturo).not.toContain('31/12/2026');

    const comInatividade = buildTaskReason(
      { lastContactAt: OLD_CONTACT, expectedCloseDate: new Date(2026, 11, 31) },
      NOW,
    );

    expect(comInatividade).not.toContain('Previsão');
    expect(comInatividade).toBe(INACTIVITY_REASON);
  });

  it('usa o texto de inatividade quando só a inatividade dispara', () => {
    const reason = buildTaskReason({ lastContactAt: OLD_CONTACT, expectedCloseDate: null }, NOW);

    expect(reason).toBe('Sem contato há mais de 48h');
    expect(INACTIVITY_REASON).toBe('Sem contato há mais de 48h');
  });

  it('cita as duas causas quando previsão vencida e inatividade coexistem', () => {
    const reason = buildTaskReason(
      { lastContactAt: OLD_CONTACT, expectedCloseDate: new Date(2026, 9, 20) },
      NOW,
    );

    expect(reason).toContain('vencida');
    expect(reason).toContain(INACTIVITY_REASON);
  });
});

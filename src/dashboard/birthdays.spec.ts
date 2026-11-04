import type { AuthUser } from '../common/auth/auth.types.js';
import { LeadSpecialDateType } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  BIRTHDAY_WINDOW_DAYS,
  daysUntilDayMonth,
  isWithinBirthdayWindow,
  parseDayMonth,
} from './birthdays.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Testes do cálculo de aniversários/datas especiais.
 *
 * O banco guarda só `'DD/MM'`; o "quantos dias faltam" precisa dar a volta no
 * ano e ignorar a hora do dia.
 */

/** Data local sem hora, para deixar claro que a hora não entra na conta. */
function day(year: number, month: number, date: number, hour = 0): Date {
  return new Date(year, month - 1, date, hour, 0, 0, 0);
}

describe('parseDayMonth', () => {
  it('decompõe `DD/MM` em dia e mês', () => {
    expect(parseDayMonth('02/01')).toEqual({ day: 2, month: 1 });
    expect(parseDayMonth('29/02')).toEqual({ day: 29, month: 2 });
    expect(parseDayMonth(' 31/12 ')).toEqual({ day: 31, month: 12 });
  });

  it('devolve `null` fora do formato `DD/MM`', () => {
    expect(parseDayMonth('')).toBeNull();
    expect(parseDayMonth('2/1')).toBeNull();
    expect(parseDayMonth('2026-01-02')).toBeNull();
    expect(parseDayMonth('02-01')).toBeNull();
    expect(parseDayMonth('abc')).toBeNull();
    expect(parseDayMonth('00/05')).toBeNull();
    expect(parseDayMonth('32/05')).toBeNull();
    expect(parseDayMonth('10/13')).toBeNull();
  });
});

describe('daysUntilDayMonth', () => {
  it('devolve 0 quando a data é hoje', () => {
    expect(daysUntilDayMonth('28/10', day(2026, 10, 28))).toBe(0);
  });

  it('devolve 1 quando a data é amanhã', () => {
    expect(daysUntilDayMonth('29/10', day(2026, 10, 28))).toBe(1);
  });

  it('ignora a hora do dia de referência', () => {
    expect(daysUntilDayMonth('28/10', day(2026, 10, 28, 23))).toBe(0);
    expect(daysUntilDayMonth('29/10', day(2026, 10, 28, 23))).toBe(1);
  });

  it('atravessa a virada do ano: 28/12 → 02/01 são 5 dias @spec:AC-125', () => {
    expect(daysUntilDayMonth('02/01', day(2026, 12, 28))).toBe(5);
  });

  it('data já passada no ano aponta para o próximo ano', () => {
    // De 20/10 até 05/03 do ano seguinte.
    expect(daysUntilDayMonth('05/03', day(2026, 10, 20))).toBe(136);
  });

  it('29/02 em ano não bissexto cai em 01/03', () => {
    // 2026 não é bissexto: 15/01 → 01/03 = 45 dias.
    expect(daysUntilDayMonth('29/02', day(2026, 1, 15))).toBe(45);
  });

  it('29/02 em ano bissexto continua sendo 29/02', () => {
    // 2028 é bissexto: 15/01 → 29/02 = 45 dias (janeiro tem 31).
    expect(daysUntilDayMonth('29/02', day(2028, 1, 15))).toBe(45);
  });

  it('dia inexistente no mês é normalizado pelo `Date.UTC` (31/02 → 03/03)', () => {
    // Comportamento real documentado em `parseDayMonth`: a faixa 1…31 por mês
    // não é validada, então 31/02 vira 03/03.
    expect(daysUntilDayMonth('31/02', day(2026, 1, 15))).toBe(47);
  });

  it('devolve `NaN` para `DD/MM` inválido', () => {
    const result = daysUntilDayMonth('31/13', day(2026, 10, 28));

    expect(result).toBeNaN();
    expect(Number.isNaN(daysUntilDayMonth('', day(2026, 10, 28)))).toBe(true);
  });
});

describe('isWithinBirthdayWindow', () => {
  it('a janela de 7 dias é inclusiva nas duas pontas', () => {
    expect(BIRTHDAY_WINDOW_DAYS).toBe(7);
    expect(isWithinBirthdayWindow(0)).toBe(true);
    expect(isWithinBirthdayWindow(7)).toBe(true);
  });

  it('descarta o que está fora da janela ou é inválido', () => {
    expect(isWithinBirthdayWindow(8)).toBe(false);
    expect(isWithinBirthdayWindow(-1)).toBe(false);
    expect(isWithinBirthdayWindow(Number.NaN)).toBe(false);
    expect(isWithinBirthdayWindow(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('DashboardService — widget de aniversariantes', () => {
  /**
   * Dublê mínimo de `PrismaService`: o widget só depende de `LeadSpecialDate`
   * (e das consultas do dashboard do vendedor, que devolvem vazio).
   */
  function serviceWith(specialDates: unknown[]): DashboardService {
    const prisma = {
      stage: { findMany: async () => [] },
      tenantLead: { findMany: async () => [], count: async () => 0 },
      leadSpecialDate: { findMany: async () => specialDates },
      $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    };

    return new DashboardService(prisma as unknown as PrismaService);
  }

  const seller: AuthUser = {
    userId: 'u-vendedor',
    tenantId: '11111111-1111-4111-8111-111111111111',
    sessionId: 'sess',
    role: 'USUARIO',
    operationalRole: 'VENDEDOR',
  };

  /** `'DD/MM'` de hoje + `offset` dias (o service usa o relógio real). */
  function dayMonthIn(offset: number): string {
    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);

    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(
      2,
      '0',
    )}`;
  }

  function entry(leadId: string, offset: number): Record<string, unknown> {
    return {
      leadId,
      dateType: LeadSpecialDateType.ANIVERSARIO_EMPRESA,
      dayMonth: dayMonthIn(offset),
      lead: { companyName: leadId, tradeName: null, contacts: [] },
    };
  }

  it('marca `is_today` só para a data de hoje e ordena pelo que falta', async () => {
    const service = serviceWith([entry('daqui-a-3', 3), entry('hoje', 0), entry('amanha', 1)]);

    const result = await service.getSellerDashboard(seller, {});

    expect(result.birthdays.map((item) => item.lead_id)).toEqual([
      'hoje',
      'amanha',
      'daqui-a-3',
    ]);
    expect(result.birthdays.map((item) => item.is_today)).toEqual([true, false, false]);
    expect(result.birthdays.map((item) => item.days_until)).toEqual([0, 1, 3]);
  });

  it('mantém a janela inclusiva de 7 dias', async () => {
    const service = serviceWith([entry('dia-7', 7), entry('dia-8', 8)]);

    const result = await service.getSellerDashboard(seller, {});

    expect(result.birthdays.map((item) => item.lead_id)).toEqual(['dia-7']);
    expect(result.birthdays[0].days_until).toBe(BIRTHDAY_WINDOW_DAYS);
  });
});

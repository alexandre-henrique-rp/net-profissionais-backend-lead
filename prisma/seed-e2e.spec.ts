import { describe, expect, it } from 'vitest';
import { daysUntilDayMonth } from '../src/dashboard/birthdays.js';
import {
  assertE2eAllowed,
  buildE2eResetPlan,
  buildE2eScenario,
  e2eId,
  E2E_STAGES,
  E2E_TENANT_ID,
  E2E_TENANT_NAME,
  type BuildScenarioInput,
  type E2eScenario,
} from './e2e-scenario.js';

/** Instante fixo em horário local — independe do fuso da máquina. */
const NOW = new Date(2026, 9, 28, 15, 0, 0);

const INPUT: BuildScenarioInput = {
  now: NOW,
  passwordHash: 'hash-de-teste',
  webhookToken: 'token-webhook-de-teste',
  inviteToken: 'token-convite-de-teste',
};

function scenario(): E2eScenario {
  return buildE2eScenario(INPUT);
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seed de homologação (E2E)', () => {
  it('@spec:AC-172 cria a corporação isolada com as sete etapas e os três perfis', () => {
    const data = scenario();

    expect(data.tenant.id).toBe(E2E_TENANT_ID);
    expect(data.tenant.name).toBe(E2E_TENANT_NAME);
    expect(data.stages).toHaveLength(7);
    expect(data.stages.map((stage) => stage.code)).toEqual(
      E2E_STAGES.map((stage) => stage.code),
    );
    expect(data.stages.filter((stage) => stage.isLostStage)).toHaveLength(1);

    const roles = new Set(data.users.map((user) => user.operationalRole));
    expect(roles).toEqual(new Set(['ADMIN', 'CAPTADOR', 'VENDEDOR']));

    // Um único administrador: é o cenário do 422 LAST_ADMIN.
    expect(
      data.users.filter(
        (user) => user.role === 'ADMIN' && user.status === 'ACTIVE',
      ),
    ).toHaveLength(1);

    const pending = data.users.find((user) => user.status === 'PENDING');
    expect(pending).toMatchObject({
      inviteToken: INPUT.inviteToken,
      email: 'pendente@e2e.netprofissional.test',
    });
    expect(pending?.inviteExpiresAt?.getTime()).toBeGreaterThan(NOW.getTime());

    expect(data.users.find((user) => user.status === 'BLOCKED')).toBeDefined();
    expect(
      data.users.every((user) =>
        user.email.endsWith('@e2e.netprofissional.test'),
      ),
    ).toBe(true);
    // A senha nunca é literal: chega como hash do ambiente.
    expect(
      data.users.every((user) => user.passwordHash === INPUT.passwordHash),
    ).toBe(true);
  });

  it('@spec:AC-173 o Pool nasce com leads disponíveis que exercitam os filtros', () => {
    const data = scenario();
    const pool = data.opportunities.filter(
      (opportunity) => opportunity.status === 'AVAILABLE',
    );

    expect(pool.length).toBeGreaterThanOrEqual(4);
    expect(
      pool.every((opportunity) => opportunity.assignedUserSlug === null),
    ).toBe(true);
    expect(
      pool.every((opportunity) => opportunity.stageCode === '1_novo_lead'),
    ).toBe(true);

    const leads = data.leads.filter((lead) =>
      pool.some((opportunity) => opportunity.leadSlug === lead.slug),
    );

    expect(new Set(leads.map((lead) => lead.state)).size).toBeGreaterThan(1);
    expect(
      new Set(leads.map((lead) => lead.sector)).size,
    ).toBeGreaterThanOrEqual(3);
    expect(new Set(leads.map((lead) => lead.temperature))).toEqual(
      new Set(['QUENTE', 'MORNO', 'FRIO']),
    );
    expect(leads.some((lead) => lead.personType === 'PF' && lead.cpf)).toBe(
      true,
    );

    // Um lead devolvido ao Pool continua sem responsável e com a captação gravada.
    const returned = data.opportunities.find(
      (opportunity) => opportunity.status === 'RETURNED_TO_POOL',
    );
    expect(returned?.assignedUserSlug).toBeNull();
    expect(returned?.claimedAt).toBeInstanceOf(Date);
  });

  it('@spec:AC-174 o funil nasce com cards em todas as etapas, perda com motivo e alerta', () => {
    const data = scenario();
    const claimed = data.opportunities.filter(
      (opportunity) => opportunity.status === 'CLAIMED',
    );
    const board = data.opportunities.filter(
      (opportunity) => opportunity.assignedUserSlug !== null,
    );

    // Todas as sete etapas têm card (a de perda carrega o card perdido).
    expect(new Set(board.map((opportunity) => opportunity.stageCode))).toEqual(
      new Set(E2E_STAGES.map((stage) => stage.code)),
    );
    expect(
      claimed.every((opportunity) => (opportunity.ticketValue ?? 0) > 0),
    ).toBe(true);

    const lost = data.opportunities.find(
      (opportunity) => opportunity.status === 'LOST',
    );
    expect(lost?.stageCode).toBe('7_perdido');
    expect(lost?.lossReasonCode).toBe('preco');
    expect(lost?.lossReasonNotes).toBeTruthy();

    const won = claimed.find(
      (opportunity) => opportunity.stageCode === '6_fechado_ganho',
    );
    expect(won).toBeDefined();

    // Alerta de inatividade: nunca contatado ou parado há mais de 48h.
    const stagnant = claimed.filter(
      (opportunity) =>
        opportunity.lastContactAt === null ||
        NOW.getTime() - opportunity.lastContactAt.getTime() >
          48 * 60 * 60 * 1000,
    );
    expect(stagnant.length).toBeGreaterThanOrEqual(2);

    const solar = data.opportunities.find(
      (opportunity) => opportunity.leadSlug === 'solar-tech',
    );
    expect(solar?.assignedUserSlug).toBe('vendedor1');
    expect(solar?.notes.length).toBeGreaterThanOrEqual(3);

    // Dois vendedores com carteira: o Administrador consegue filtrar por dono.
    expect(
      new Set(
        claimed
          .map((opportunity) => opportunity.assignedUserSlug)
          .filter((slug): slug is NonNullable<typeof slug> => slug !== null),
      ),
    ).toEqual(new Set(['vendedor1', 'vendedor2']));
  });

  it('@spec:AC-175 a agenda nasce com previsão vencida, para hoje e aniversário na janela', () => {
    const data = scenario();
    const startOfToday = new Date(
      NOW.getFullYear(),
      NOW.getMonth(),
      NOW.getDate(),
    ).getTime();

    const closeDates = data.opportunities
      .map((opportunity) => opportunity.expectedCloseDate)
      .filter((date): date is Date => date !== null);

    expect(closeDates.some((date) => date.getTime() < startOfToday)).toBe(true);
    expect(
      closeDates.some(
        (date) =>
          date.getTime() ===
          new Date(
            NOW.getFullYear(),
            NOW.getMonth(),
            NOW.getDate(),
            12,
          ).getTime(),
      ),
    ).toBe(true);
    expect(
      data.opportunities.some(
        (opportunity) => opportunity.expectedCloseDate === null,
      ),
    ).toBe(true);

    // Aniversários: o widget do vendedor lê `LeadSpecialDate.dayMonth`.
    const dates = data.leads.flatMap((lead) => lead.specialDates);
    const inWindow = dates
      .map((date) => daysUntilDayMonth(date.dayMonth, NOW))
      .filter((days) => days >= 0 && days <= 7);

    expect(inWindow.length).toBeGreaterThanOrEqual(2);
    expect(dates.some((date) => date.dateType === 'ANIVERSARIO_SOCIO')).toBe(
      true,
    );
    expect(dates.some((date) => date.dateType === 'ANIVERSARIO_EMPRESA')).toBe(
      true,
    );

    const solarDate = data.leads
      .find((lead) => lead.slug === 'solar-tech')
      ?.specialDates.find((date) => date.dateType === 'ANIVERSARIO_SOCIO');
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 3);
    expect(solarDate?.dayMonth).toBe(
      `${String(expected.getDate()).padStart(2, '0')}/${String(
        expected.getMonth() + 1,
      ).padStart(2, '0')}`,
    );
  });

  it('@spec:AC-176 o cenário é determinístico e o reset devolve o mesmo estado', () => {
    const first = buildE2eScenario(INPUT);
    const second = buildE2eScenario(INPUT);

    // Mesmo instante e mesmos segredos → mesmo objeto (reaplicar não duplica).
    expect(second).toEqual(first);

    const ids = [
      first.tenant.id,
      ...first.stages.map((stage) => stage.id),
      ...first.users.map((user) => user.id),
      ...first.leads.map((lead) => lead.id),
      ...first.leads.flatMap((lead) =>
        lead.contacts.map((contact) => contact.id),
      ),
      ...first.leads.flatMap((lead) =>
        lead.specialDates.map((date) => date.id),
      ),
      ...first.opportunities.map((opportunity) => opportunity.id),
      ...first.opportunities.flatMap((opportunity) =>
        opportunity.notes.map((note) => note.id),
      ),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(e2eId('tenant')).toBe(E2E_TENANT_ID);

    const plan = buildE2eResetPlan(first);
    expect(plan.tenantId).toBe(first.tenant.id);
    expect(plan.cnpjs).toEqual(
      first.leads
        .map((lead) => lead.cnpj)
        .filter((document): document is string => document !== null),
    );
    expect(plan.cpfs).toEqual(
      first.leads
        .map((lead) => lead.cpf)
        .filter((document): document is string => document !== null),
    );

    // Documentos fiscais únicos e no tamanho certo (CNPJ 14, CPF 11).
    const documents = first.leads.flatMap((lead) => [lead.cnpj, lead.cpf]);
    const present = documents.filter(
      (document): document is string => document !== null,
    );
    expect(new Set(present).size).toBe(present.length);
    expect(
      present.every((document) => /^(\d{14}|\d{11})$/.test(document)),
    ).toBe(true);
  });

  it('@spec:AC-177 a seed exige os segredos do ambiente e confirma produção', () => {
    expect(() => assertE2eAllowed({})).toThrow(/DATABASE_URL/);

    expect(() =>
      assertE2eAllowed({
        DATABASE_URL: 'postgresql://teste',
        SEED_E2E_PASSWORD: 'senha',
        SEED_E2E_WEBHOOK_TOKEN: 'token',
        SEED_E2E_INVITE_TOKEN: 'convite',
      }),
    ).not.toThrow();

    expect(() =>
      assertE2eAllowed({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://teste',
        SEED_E2E_PASSWORD: 'senha',
        SEED_E2E_WEBHOOK_TOKEN: 'token',
        SEED_E2E_INVITE_TOKEN: 'convite',
      }),
    ).toThrow(/SEED_E2E_ALLOW_PROD/);

    expect(() =>
      assertE2eAllowed({
        NODE_ENV: 'production',
        SEED_E2E_ALLOW_PROD: '1',
        DATABASE_URL: 'postgresql://teste',
        SEED_E2E_PASSWORD: 'senha',
        SEED_E2E_WEBHOOK_TOKEN: 'token',
        SEED_E2E_INVITE_TOKEN: 'convite',
      }),
    ).not.toThrow();
  });
});

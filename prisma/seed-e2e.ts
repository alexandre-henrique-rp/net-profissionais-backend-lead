/**
 * Seed de homologação (`TASK-S06-06`) — NetProfissional.
 *
 * Recria o tenant de E2E com um cenário determinístico para o Playwright:
 * administrador, dois vendedores, um captador, uma conta pendente e uma
 * bloqueada; Pool com filtros; funil com as sete etapas; agenda do dia e
 * aniversariantes; linha do tempo pronta para a gaveta.
 *
 * Como rodar (na pasta `backend`):
 *
 *   yarn prisma:deploy      # aplica as migrations
 *   yarn prisma:seed:e2e    # recria o cenário de homologação
 *
 * A seed é **idempotente por reset**: apaga o tenant de homologação e recria
 * tudo com os mesmos IDs. Rodar duas vezes devolve o mesmo estado inicial —
 * inclusive desfazendo captações e movimentações do teste anterior.
 *
 * Nenhum segredo fica no código: senha, token do webhook e token do convite
 * vêm do ambiente (ver `.env.example`).
 */
import 'dotenv/config';
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  assertE2eAllowed,
  buildE2eResetPlan,
  buildE2eScenario,
  e2eId,
  E2E_DOMAIN,
  E2E_TENANT_ID,
  E2E_TENANT_NAME,
  type E2eScenario,
} from './e2e-scenario.js';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `A variável ${name} é obrigatória para a seed de E2E. Defina-a no .env (veja .env.example).`,
    );
  }

  return value;
}

/** UUID do lead a partir do slug (o cenário guarda os dois). */
function leadId(slug: string): string {
  return e2eId(`lead:${slug}`);
}

function userId(slug: string): string {
  return e2eId(`user:${slug}`);
}

function stageId(code: string): string {
  return e2eId(`stage:${code}`);
}

/**
 * Aplica o cenário: reset do tenant + recriação completa.
 *
 * As tabelas são apagadas **na ordem das dependências** dentro de uma
 * transação. `TenantLead.stageId` é `ON DELETE RESTRICT`, então confiar apenas
 * no cascade do `Tenant` pode falhar no Postgres (a etapa seria apagada antes
 * da oportunidade que a referencia). Notas → oportunidades → datas → contatos
 * → etapas → usuários → tenant elimina a ambiguidade.
 *
 * Depois, os documentos globais que ficaram sem vínculo são removidos para não
 * acumular lixo entre execuções — inclusive os leads que o teste criou por
 * webhook ou cadastro manual (capturados antes do reset).
 */
export async function applyE2eScenario(
  prisma: PrismaClient,
  scenario: E2eScenario,
): Promise<void> {
  const plan = buildE2eResetPlan(scenario);

  const existing = await prisma.tenant.findUnique({
    where: { id: plan.tenantId },
    select: { name: true },
  });

  // Segurança: o ID é derivado de uma chave fixa. Se alguém ocupou esse ID com
  // outro tenant, apagar seria destrutivo — aborta em vez de adivinhar.
  if (existing && existing.name !== E2E_TENANT_NAME) {
    throw new Error(
      `O tenant ${plan.tenantId} já existe com o nome "${existing.name}", diferente do marcador de E2E. Nada foi apagado.`,
    );
  }

  // Leads que pertenciam ao tenant de homologação antes do reset: o teste pode
  // ter criado leads (webhook, cadastro manual) que não estão no cenário. Sem
  // esta captura, eles virariam `Lead` global órfão a cada rodada.
  const linkedLeadIds = (
    await prisma.tenantLead.findMany({
      where: { tenantId: plan.tenantId },
      select: { leadId: true },
    })
  ).map((row) => row.leadId);

  await prisma.$transaction([
    prisma.leadTimelineNote.deleteMany({
      where: { tenantLead: { tenantId: plan.tenantId } },
    }),
    prisma.tenantLead.deleteMany({ where: { tenantId: plan.tenantId } }),
    prisma.leadSpecialDate.deleteMany({ where: { tenantId: plan.tenantId } }),
    prisma.leadContact.deleteMany({ where: { tenantId: plan.tenantId } }),
    prisma.stage.deleteMany({ where: { tenantId: plan.tenantId } }),
    prisma.user.deleteMany({ where: { tenantId: plan.tenantId } }),
    prisma.tenant.deleteMany({ where: { id: plan.tenantId } }),
  ]);

  const documents = [
    ...(plan.cnpjs.length > 0 ? [{ cnpj: { in: plan.cnpjs } }] : []),
    ...(plan.cpfs.length > 0 ? [{ cpf: { in: plan.cpfs } }] : []),
  ];

  if (documents.length > 0) {
    await prisma.lead.deleteMany({
      where: { tenantLeads: { none: {} }, OR: documents },
    });
  }

  if (linkedLeadIds.length > 0) {
    await prisma.lead.deleteMany({
      where: { id: { in: linkedLeadIds }, tenantLeads: { none: {} } },
    });
  }

  await prisma.tenant.create({ data: scenario.tenant });

  await prisma.stage.createMany({
    data: scenario.stages.map((stage) => ({
      ...stage,
      tenantId: scenario.tenant.id,
    })),
  });

  await prisma.user.createMany({
    data: scenario.users.map(({ slug: _slug, ...user }) => ({
      ...user,
      tenantId: scenario.tenant.id,
    })),
  });

  await prisma.lead.createMany({
    data: scenario.leads.map((lead) => ({
      id: lead.id,
      personType: lead.personType,
      cnpj: lead.cnpj,
      cpf: lead.cpf,
      companyName: lead.companyName,
      tradeName: lead.tradeName,
      primaryCnae: lead.primaryCnae,
      cnaeDescription: lead.cnaeDescription,
      capitalSocial: lead.capitalSocial,
      postalCode: lead.postalCode,
      street: lead.street,
      number: lead.number,
      complement: lead.complement,
      neighborhood: lead.neighborhood,
      city: lead.city,
      state: lead.state,
      sector: lead.sector,
      companySize: lead.companySize,
      temperature: lead.temperature,
      temperatureScore: lead.temperatureScore,
    })),
  });

  await prisma.leadContact.createMany({
    data: scenario.leads.flatMap((lead) =>
      lead.contacts.map((contact) => ({
        id: contact.id,
        tenantId: scenario.tenant.id,
        leadId: leadId(contact.leadSlug),
        name: contact.name,
        role: contact.role,
        phone: contact.phone,
        email: contact.email,
        birthday: contact.birthday,
        isPrimary: contact.isPrimary,
        isDecisionMaker: contact.isDecisionMaker,
      })),
    ),
  });

  await prisma.leadSpecialDate.createMany({
    data: scenario.leads.flatMap((lead) =>
      lead.specialDates.map((date) => ({
        id: date.id,
        tenantId: scenario.tenant.id,
        leadId: leadId(date.leadSlug),
        dateType: date.dateType,
        dayMonth: date.dayMonth,
        description: date.description,
      })),
    ),
  });

  await prisma.tenantLead.createMany({
    data: scenario.opportunities.map((opportunity) => ({
      id: opportunity.id,
      tenantId: scenario.tenant.id,
      leadId: leadId(opportunity.leadSlug),
      stageId: stageId(opportunity.stageCode),
      assignedUserId: opportunity.assignedUserSlug
        ? userId(opportunity.assignedUserSlug)
        : null,
      creatorUserId: opportunity.creatorUserSlug
        ? userId(opportunity.creatorUserSlug)
        : null,
      status: opportunity.status,
      ticketValue: opportunity.ticketValue,
      closeProbability: opportunity.closeProbability,
      expectedCloseDate: opportunity.expectedCloseDate,
      proposalScope: opportunity.proposalScope,
      lossReasonCode: opportunity.lossReasonCode,
      lossReasonNotes: opportunity.lossReasonNotes,
      lastContactAt: opportunity.lastContactAt,
      claimedAt: opportunity.claimedAt,
      version: opportunity.version,
    })),
  });

  await prisma.leadTimelineNote.createMany({
    data: scenario.opportunities.flatMap((opportunity) =>
      opportunity.notes.map((note) => ({
        id: note.id,
        tenantLeadId: opportunity.id,
        userId: userId(note.userSlug),
        type: note.type,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt,
      })),
    ),
  });
}

async function main(prisma: PrismaClient): Promise<void> {
  const password = requiredEnv('SEED_E2E_PASSWORD');
  const webhookToken = requiredEnv('SEED_E2E_WEBHOOK_TOKEN');
  const inviteToken = requiredEnv('SEED_E2E_INVITE_TOKEN');

  const scenario = buildE2eScenario({
    now: new Date(),
    passwordHash: await hash(password),
    webhookToken,
    inviteToken,
  });

  await applyE2eScenario(prisma, scenario);

  const claimed = scenario.opportunities.filter(
    (opportunity) => opportunity.status === 'CLAIMED',
  ).length;

  console.log('✔ Seed de E2E aplicada.');
  console.log(`  tenant: ${E2E_TENANT_ID} (${E2E_TENANT_NAME})`);
  console.log(
    `  ${scenario.users.length} usuários · ${scenario.stages.length} etapas · ${scenario.leads.length} leads (${claimed} em carteira)`,
  );
  console.log(
    `  login admin: admin@${E2E_DOMAIN} (senha em SEED_E2E_PASSWORD)`,
  );
  console.log(
    `  convite pendente: pendente@${E2E_DOMAIN} (token em SEED_E2E_INVITE_TOKEN)`,
  );
}

const isDirectRun = process.argv[1]?.includes('seed-e2e');

if (isDirectRun) {
  assertE2eAllowed(process.env);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requiredEnv('DATABASE_URL') }),
  });

  main(prisma)
    .catch((error) => {
      console.error('✘ Seed de E2E falhou:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

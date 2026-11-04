/**
 * Seed do MVP 1 — NetProfissional.
 *
 * Cria (de forma idempotente) o tenant padrão, as 7 etapas comerciais do Kanban
 * e o usuário administrador inicial.
 *
 * Fonte: doc/mvp/specs/task-s01-06.md
 *
 * Nenhum segredo fica no código: a senha do admin e o token de webhook do
 * tenant vêm do ambiente (ver `.env.example`).
 */
import { hash } from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

export const SEED_TENANT = {
  id: '1209f89d-8328-80f5-8008-d08667c53da5',
  name: 'NetProfissional Tecnologia',
  tradeName: 'NetProfissional',
  maxUsers: 10,
} as const;

export const SEED_ADMIN = {
  email: 'carlos.admin@netprofissional.com.br',
  name: 'Carlos Admin',
} as const;

/** As 7 etapas comerciais tradicionais, na ordem de position. */
export const SEED_STAGES = [
  { code: '1_novo_lead', name: '1. Novo Lead / Recebido', colorHex: '#38BDF8' },
  { code: '2_qualificacao', name: '2. Qualificação', colorHex: '#8B5CF6' },
  { code: '3_apresentacao', name: '3. Apresentação / Reunião', colorHex: '#F59E0B' },
  { code: '4_proposta', name: '4. Envio de Proposta', colorHex: '#EB3A42' },
  { code: '5_negociacao', name: '5. Negociação', colorHex: '#D60037' },
  { code: '6_fechado_ganho', name: '6. Fechado / Ganho', colorHex: '#10B981' },
  { code: '7_perdido', name: '7. Perdido', colorHex: '#737887' },
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `A variável ${name} é obrigatória para o seed. Defina-a no .env (veja .env.example).`,
    );
  }
  return value;
}

export async function main(prisma: PrismaClient): Promise<void> {
  const adminPassword = requiredEnv('SEED_ADMIN_PASSWORD');
  const webhookToken = requiredEnv('SEED_TENANT_WEBHOOK_TOKEN');

  const tenant = await prisma.tenant.upsert({
    where: { id: SEED_TENANT.id },
    update: { name: SEED_TENANT.name, webhookToken },
    create: {
      id: SEED_TENANT.id,
      name: SEED_TENANT.name,
      tradeName: SEED_TENANT.tradeName,
      webhookToken,
      maxUsers: SEED_TENANT.maxUsers,
    },
  });

  for (const [index, stage] of SEED_STAGES.entries()) {
    await prisma.stage.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: stage.code } },
      update: { name: stage.name, position: index + 1, colorHex: stage.colorHex },
      create: {
        tenantId: tenant.id,
        name: stage.name,
        code: stage.code,
        position: index + 1,
        colorHex: stage.colorHex,
        isLostStage: stage.code === '7_perdido',
      },
    });
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: SEED_ADMIN.email } },
  });

  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        name: SEED_ADMIN.name,
        role: 'ADMIN',
        operationalRole: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  } else {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: SEED_ADMIN.email,
        name: SEED_ADMIN.name,
        passwordHash: await hash(adminPassword),
        role: 'ADMIN',
        operationalRole: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  }
}

const isDirectRun = process.argv[1]?.includes('seed');

if (isDirectRun) {
  const connectionString = requiredEnv('DATABASE_URL');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  main(prisma)
    .then(async () => {
      console.log('✔ Seed aplicado: tenant, 7 etapas e administrador inicial.');
    })
    .catch((error) => {
      console.error('✘ Seed falhou:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

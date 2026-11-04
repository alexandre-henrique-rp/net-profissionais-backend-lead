-- Migration 1 — Escopo de tenant para dado pessoal + timestamp de captação.
--
-- Motivo (auditoria de isolamento):
--   1. `LeadContact` e `LeadSpecialDate` pendiam só de `Lead`. Como `Lead` é uma
--      identidade global (o mesmo CNPJ pode estar em várias corporações), a
--      corporação B lia telefone/e-mail/aniversário cadastrados pela A (LGPD).
--   2. A cota diária de captação do Pool era medida por `TenantLead.updatedAt`,
--      que muda a qualquer edição e é reescrito ao devolver o lead ao Pool.
--      `claimedAt` registra a captação e nunca é zerado.
--
-- Escrita à mão (não há banco disponível para `prisma migrate dev`). Cada passo
-- depende do anterior: colunas primeiro, backfill, depois NOT NULL, índices e FKs.

-- 1) Timestamp de captação -----------------------------------------------------
ALTER TABLE "TenantLead" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

-- 2) e 3) Colunas de tenant (nulas neste ponto, para permitir o backfill) ------
ALTER TABLE "LeadContact" ADD COLUMN IF NOT EXISTS "tenantId" UUID;
ALTER TABLE "LeadSpecialDate" ADD COLUMN IF NOT EXISTS "tenantId" UUID;

-- 4) Backfill -----------------------------------------------------------------
--
-- Abordagem escolhida: DUPLICAR a linha por tenant distinto do `leadId`
-- (INSERT ... SELECT + DELETE das originais). A alternativa de `UPDATE ... SET
-- "tenantId" = (SELECT ... LIMIT 1)` seria mais curta, mas escolheria um tenant
-- arbitrário e daria os contatos de um tenant para todos os outros — que é
-- exatamente o vazamento que esta migration corrige. A duplicação preserva o
-- comportamento correto quando o mesmo lead já está em mais de uma corporação.
--
-- `gen_random_uuid()` é nativo no PostgreSQL 13+ (pgcrypto embutido); os novos
-- `id` precisam ser distintos das linhas originais.

INSERT INTO "LeadContact" (
    "id",
    "tenantId",
    "leadId",
    "name",
    "role",
    "phone",
    "email",
    "birthday",
    "isPrimary",
    "isDecisionMaker",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid(),
    tl."tenantId",
    c."leadId",
    c."name",
    c."role",
    c."phone",
    c."email",
    c."birthday",
    c."isPrimary",
    c."isDecisionMaker",
    c."createdAt",
    c."updatedAt"
FROM "LeadContact" c
JOIN "TenantLead" tl ON tl."leadId" = c."leadId"
WHERE c."tenantId" IS NULL;

-- Remove as linhas originais (sem tenant) já copiadas por tenant.
-- O `EXISTS` limita o DELETE ao que realmente foi duplicado: contato de lead que
-- não está em nenhum tenant NÃO é apagado (fica para o operador resolver).
DELETE FROM "LeadContact" c
WHERE c."tenantId" IS NULL
  AND EXISTS (SELECT 1 FROM "TenantLead" tl WHERE tl."leadId" = c."leadId");

INSERT INTO "LeadSpecialDate" (
    "id",
    "tenantId",
    "leadId",
    "dateType",
    "dayMonth",
    "description",
    "createdAt"
)
SELECT
    gen_random_uuid(),
    tl."tenantId",
    d."leadId",
    d."dateType",
    d."dayMonth",
    d."description",
    d."createdAt"
FROM "LeadSpecialDate" d
JOIN "TenantLead" tl ON tl."leadId" = d."leadId"
WHERE d."tenantId" IS NULL;

DELETE FROM "LeadSpecialDate" d
WHERE d."tenantId" IS NULL
  AND EXISTS (SELECT 1 FROM "TenantLead" tl WHERE tl."leadId" = d."leadId");

-- Guarda de integridade antes do NOT NULL: um contato/data órfão (lead que não
-- está em nenhum tenant) não tem tenant para herdar. Nada é apagado — a migration
-- aborta com mensagem explícita e o operador resolve manualmente.
DO $$
DECLARE
    orphans_contact INT;
    orphans_special INT;
BEGIN
    SELECT COUNT(*) INTO orphans_contact FROM "LeadContact" WHERE "tenantId" IS NULL;
    SELECT COUNT(*) INTO orphans_special FROM "LeadSpecialDate" WHERE "tenantId" IS NULL;

    IF orphans_contact > 0 OR orphans_special > 0 THEN
        RAISE EXCEPTION
            'Backfill incompleto: % LeadContact e % LeadSpecialDate sem tenant (lead fora de qualquer TenantLead). Resolva manualmente antes de reaplicar.',
            orphans_contact, orphans_special;
    END IF;
END $$;

-- 5) NOT NULL -----------------------------------------------------------------
ALTER TABLE "LeadContact" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "LeadSpecialDate" ALTER COLUMN "tenantId" SET NOT NULL;

-- 6) Índices ------------------------------------------------------------------
-- Os índices por `leadId` da migration 0 são mantidos; estes cobrem o filtro
-- por tenant (toda leitura de contato passa a ser `WHERE tenantId = ...`).
CREATE INDEX IF NOT EXISTS "LeadContact_tenantId_leadId_idx" ON "LeadContact"("tenantId", "leadId");
CREATE INDEX IF NOT EXISTS "LeadSpecialDate_tenantId_leadId_idx" ON "LeadSpecialDate"("tenantId", "leadId");
-- Base da cota diária: quantas captações o usuário fez no dia.
CREATE INDEX IF NOT EXISTS "TenantLead_assignedUserId_claimedAt_idx" ON "TenantLead"("assignedUserId", "claimedAt");

-- 7) FKs para Tenant ----------------------------------------------------------
-- CASCADE: apagar a corporação apaga os dados pessoais que ela guardava.
ALTER TABLE "LeadContact"
    ADD CONSTRAINT "LeadContact_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadSpecialDate"
    ADD CONSTRAINT "LeadSpecialDate_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8) Documento único em `Lead` -------------------------------------------------
--
-- ATENÇÃO OPERADOR: se a base já tiver CNPJ/CPF repetido em `Lead`, o
-- `CREATE UNIQUE INDEX` abaixo FALHA (não há saneamento destrutivo aqui — nenhum
-- dado é apagado por esta migration). Consolide os duplicados manualmente
-- (mover `TenantLead`/contatos/datas para o `Lead` que fica e remover o extra) e
-- reaplique a migration.
CREATE UNIQUE INDEX "Lead_cnpj_key" ON "Lead"("cnpj");
CREATE UNIQUE INDEX "Lead_cpf_key" ON "Lead"("cpf");

-- O índice único já atende as buscas por documento; remove os índices simples
-- criados na migration 0 para o schema não ficar com drift.
DROP INDEX IF EXISTS "Lead_cnpj_idx";
DROP INDEX IF EXISTS "Lead_cpf_idx";

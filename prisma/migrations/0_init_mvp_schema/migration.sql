-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USUARIO');

-- CreateEnum
CREATE TYPE "OperationalRole" AS ENUM ('ADMIN', 'CAPTADOR', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('PJ', 'PF');

-- CreateEnum
CREATE TYPE "TenantLeadStatus" AS ENUM ('AVAILABLE', 'CLAIMED', 'RETURNED_TO_POOL', 'LOST');

-- CreateEnum
CREATE TYPE "TenantSector" AS ENUM ('SOLAR', 'TECNOLOGIA', 'CONSTRUCAO', 'SERVICOS', 'OUTROS');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('ME', 'EPP', 'DEMAIS');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('QUENTE', 'MORNO', 'FRIO');

-- CreateEnum
CREATE TYPE "LeadTimelineNoteType" AS ENUM ('NOTE', 'CALL', 'MEETING', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "LeadSpecialDateType" AS ENUM ('ANIVERSARIO_SOCIO', 'ANIVERSARIO_EMPRESA');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" VARCHAR(14),
    "webhookToken" TEXT NOT NULL,
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "operationalRole" "OperationalRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "inviteToken" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "colorHex" VARCHAR(7) NOT NULL,
    "isLostStage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "personType" "PersonType" NOT NULL,
    "cnpj" VARCHAR(14),
    "cpf" VARCHAR(11),
    "companyName" TEXT,
    "tradeName" TEXT,
    "primaryCnae" TEXT,
    "cnaeDescription" TEXT,
    "capitalSocial" DECIMAL(14,2),
    "postalCode" VARCHAR(9),
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" VARCHAR(2),
    "sector" "TenantSector" NOT NULL DEFAULT 'OUTROS',
    "companySize" "CompanySize",
    "temperature" "LeadTemperature",
    "temperatureScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantLead" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "assignedUserId" UUID,
    "creatorUserId" UUID,
    "status" "TenantLeadStatus" NOT NULL DEFAULT 'AVAILABLE',
    "ticketValue" DECIMAL(14,2),
    "closeProbability" INTEGER,
    "expectedCloseDate" TIMESTAMP(3),
    "proposalScope" TEXT,
    "lossReasonCode" TEXT,
    "lossReasonNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastContactAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "birthday" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSpecialDate" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "dateType" "LeadSpecialDateType" NOT NULL,
    "dayMonth" VARCHAR(5) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSpecialDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTimelineNote" (
    "id" UUID NOT NULL,
    "tenantLeadId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "LeadTimelineNoteType" NOT NULL DEFAULT 'NOTE',
    "title" TEXT NOT NULL,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadTimelineNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_webhookToken_key" ON "Tenant"("webhookToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteToken_key" ON "User"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Stage_tenantId_position_idx" ON "Stage"("tenantId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_tenantId_code_key" ON "Stage"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Lead_cnpj_idx" ON "Lead"("cnpj");

-- CreateIndex
CREATE INDEX "Lead_cpf_idx" ON "Lead"("cpf");

-- CreateIndex
CREATE INDEX "TenantLead_tenantId_status_idx" ON "TenantLead"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantLead_assignedUserId_idx" ON "TenantLead"("assignedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLead_tenantId_leadId_key" ON "TenantLead"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "LeadContact_leadId_idx" ON "LeadContact"("leadId");

-- CreateIndex
CREATE INDEX "LeadSpecialDate_leadId_idx" ON "LeadSpecialDate"("leadId");

-- CreateIndex
CREATE INDEX "LeadTimelineNote_tenantLeadId_createdAt_idx" ON "LeadTimelineNote"("tenantLeadId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLead" ADD CONSTRAINT "TenantLead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLead" ADD CONSTRAINT "TenantLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLead" ADD CONSTRAINT "TenantLead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLead" ADD CONSTRAINT "TenantLead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantLead" ADD CONSTRAINT "TenantLead_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSpecialDate" ADD CONSTRAINT "LeadSpecialDate_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTimelineNote" ADD CONSTRAINT "LeadTimelineNote_tenantLeadId_fkey" FOREIGN KEY ("tenantLeadId") REFERENCES "TenantLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTimelineNote" ADD CONSTRAINT "LeadTimelineNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


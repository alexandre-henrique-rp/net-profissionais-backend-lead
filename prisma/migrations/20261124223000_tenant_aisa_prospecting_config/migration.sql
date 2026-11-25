ALTER TABLE "Tenant"
  ADD COLUMN "aisaApiKeyEncrypted" TEXT,
  ADD COLUMN "aisaBaseUrl" TEXT,
  ADD COLUMN "aiLlmProvider" VARCHAR(20),
  ADD COLUMN "aiLlmModel" VARCHAR(120),
  ADD COLUMN "aiLlmApiKeyEncrypted" TEXT,
  ADD COLUMN "aiLlmBaseUrl" TEXT;

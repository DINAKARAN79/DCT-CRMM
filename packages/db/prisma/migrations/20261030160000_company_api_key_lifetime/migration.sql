ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "publicId" TEXT;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "graceUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_publicId_key" ON "api_keys"("publicId");
CREATE INDEX IF NOT EXISTS "api_keys_keyPrefix_idx" ON "api_keys"("keyPrefix");
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_one_active_per_tenant" ON "api_keys"("tenantId") WHERE "status" = 'active' AND "revokedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "api_key_request_logs" (
  "id" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_key_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "api_key_request_logs_tenantId_createdAt_idx" ON "api_key_request_logs"("tenantId", "createdAt");

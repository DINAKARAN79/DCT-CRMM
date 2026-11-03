-- Persistent Round Robin Queue module.
-- Apply with psql against the configured PostgreSQL database.

CREATE TABLE IF NOT EXISTS "RRQueue" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "leadStatus" JSONB,
  "leadSource" JSONB,
  "secondarySource" JSONB,
  "tertiarySource" JSONB,
  "leadPriority" JSONB,
  "category" JSONB,
  "projectInterested" JSONB,
  "country" JSONB,
  "presalesQueue" BOOLEAN NOT NULL DEFAULT FALSE,
  "excludeFromNoSource" JSONB,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "startTime" TIMESTAMP(3),
  "endTime" TIMESTAMP(3),
  "ownerId" TEXT,
  "defaultOwnerId" TEXT,
  "leadCount" INTEGER NOT NULL DEFAULT 0,
  "previousId" INTEGER NOT NULL DEFAULT 0,
  "noOfUsers" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RRQueue_tenant_name_key" UNIQUE ("tenantId", "name"),
  CONSTRAINT "RRQueue_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "RRQueue_owner_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id"),
  CONSTRAINT "RRQueue_createdBy_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id"),
  CONSTRAINT "RRQueue_updatedBy_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id")
);

ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "leadSource" JSONB;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "secondarySource" JSONB;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "tertiarySource" JSONB;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "leadPriority" JSONB;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "category" JSONB;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "country" JSONB;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "startTime" TIMESTAMP(3);
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "endTime" TIMESTAMP(3);
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "defaultOwnerId" TEXT;

CREATE TABLE IF NOT EXISTS "RRQueueMember" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "name" TEXT,
  "rrQueueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sequenceId" INTEGER NOT NULL,
  "activeMember" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RRQueueMember_queue_user_key" UNIQUE ("rrQueueId", "userId"),
  CONSTRAINT "RRQueueMember_queue_sequence_key" UNIQUE ("rrQueueId", "sequenceId"),
  CONSTRAINT "RRQueueMember_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "RRQueueMember_queue_fkey" FOREIGN KEY ("rrQueueId") REFERENCES "RRQueue"("id") ON DELETE CASCADE,
  CONSTRAINT "RRQueueMember_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);

ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "userIdNumber" DECIMAL(18, 0);
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "maxLeadCapacity" INTEGER NOT NULL DEFAULT -1;
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "currentLeadCount" INTEGER NOT NULL DEFAULT 0;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS row_num
  FROM "RRQueueMember"
  WHERE "name" IS NULL OR "name" = ''
)
UPDATE "RRQueueMember" AS member
SET "name" = 'UID-' || LPAD(numbered.row_num::TEXT, 4, '0')
FROM numbered
WHERE member."id" = numbered."id";

ALTER TABLE "RRQueueMember" ALTER COLUMN "name" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "RRQueueMember_tenant_name_key"
  ON "RRQueueMember"("tenantId", "name");

INSERT INTO "Sequence" ("id", "tenantId", "type", "nextValue")
SELECT
  gen_random_uuid()::TEXT,
  "tenantId",
  'RRMEMBER',
  COALESCE(MAX(CASE WHEN "name" ~ '^UID-[0-9]+$' THEN SUBSTRING("name" FROM 5)::INTEGER END), 0)
FROM "RRQueueMember"
GROUP BY "tenantId"
ON CONFLICT ("tenantId", "type")
DO UPDATE SET "nextValue" = GREATEST("Sequence"."nextValue", EXCLUDED."nextValue");

CREATE TABLE IF NOT EXISTS "RRQueueHistory" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "rrQueueId" TEXT NOT NULL,
  "leadId" TEXT,
  "field" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "originalValue" TEXT,
  "newValue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RRQueueHistory_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "RRQueueHistory_queue_fkey" FOREIGN KEY ("rrQueueId") REFERENCES "RRQueue"("id") ON DELETE CASCADE,
  CONSTRAINT "RRQueueHistory_lead_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL,
  CONSTRAINT "RRQueueHistory_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "rrQueueId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_rrQueue_fkey" FOREIGN KEY ("rrQueueId") REFERENCES "RRQueue"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "RRQueue_tenant_idx" ON "RRQueue"("tenantId");
CREATE INDEX IF NOT EXISTS "RRQueueMember_active_idx" ON "RRQueueMember"("tenantId", "rrQueueId", "activeMember");
CREATE INDEX IF NOT EXISTS "RRQueueHistory_created_idx" ON "RRQueueHistory"("tenantId", "rrQueueId", "createdAt");
CREATE INDEX IF NOT EXISTS "Lead_rrQueue_idx" ON "Lead"("rrQueueId");

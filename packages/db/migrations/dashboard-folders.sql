-- Keep dashboard folders independent from report folders.
CREATE TABLE IF NOT EXISTS "DashboardFolder" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardFolder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DashboardFolder_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DashboardFolder_tenantId_name_key" UNIQUE ("tenantId", "name")
);
CREATE INDEX IF NOT EXISTS "DashboardFolder_tenantId_idx" ON "DashboardFolder"("tenantId");

-- Preserve existing dashboard folder assignments, but copy them into the new domain.
INSERT INTO "DashboardFolder" ("id", "tenantId", "name", "createdBy")
SELECT 'dashboard-' || rf."id", rf."tenantId", rf."name", rf."createdBy"
FROM "ReportFolder" rf
WHERE EXISTS (SELECT 1 FROM "Dashboard" d WHERE d."folderId" = rf."id")
ON CONFLICT ("id") DO NOTHING;

UPDATE "Dashboard" d
SET "folderId" = 'dashboard-' || d."folderId"
WHERE d."folderId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "ReportFolder" rf WHERE rf."id" = d."folderId");

ALTER TABLE "Dashboard" DROP CONSTRAINT IF EXISTS "Dashboard_folderId_fkey";
ALTER TABLE "Dashboard"
  ADD CONSTRAINT "Dashboard_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "DashboardFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
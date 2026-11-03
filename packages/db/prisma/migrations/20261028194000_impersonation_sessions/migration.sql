-- Superadmin company impersonation. AuditLog gains a nullable actor column.
-- Tenant and User are not altered and no foreign keys are added.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "impersonatedById" TEXT;

CREATE TABLE IF NOT EXISTS "impersonation_sessions" (
  "id" TEXT NOT NULL,
  "superadminId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actingAsUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "viewOnly" BOOLEAN NOT NULL DEFAULT false,
  "allowInactive" BOOLEAN NOT NULL DEFAULT false,
  "hardExpiresAt" TIMESTAMP(3) NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returnPath" TEXT NOT NULL,
  "notifySentAt" TIMESTAMP(3),
  "superadminLoginAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "impersonation_sessions_superadminId_endedAt_idx"
  ON "impersonation_sessions"("superadminId", "endedAt");
CREATE INDEX IF NOT EXISTS "impersonation_sessions_tenantId_startedAt_idx"
  ON "impersonation_sessions"("tenantId", "startedAt");

CREATE TABLE IF NOT EXISTS "tenant_impersonation_settings" (
  "tenantId" TEXT NOT NULL,
  "notifyOnAccess" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "tenant_impersonation_settings_pkey" PRIMARY KEY ("tenantId")
);

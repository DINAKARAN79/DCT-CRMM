ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isLoggedIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLogoutAt" TIMESTAMP(3);

UPDATE "User" SET "isLoggedIn" = false WHERE "isLoggedIn" IS DISTINCT FROM false;

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "browser" TEXT,
  "os" TEXT,
  "deviceType" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  "isImpersonation" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_sessions_sessionTokenHash_key" ON "user_sessions"("sessionTokenHash");
CREATE INDEX IF NOT EXISTS "user_sessions_tenantId_userId_endedAt_idx" ON "user_sessions"("tenantId", "userId", "endedAt");
CREATE INDEX IF NOT EXISTS "user_sessions_tenantId_lastSeenAt_idx" ON "user_sessions"("tenantId", "lastSeenAt");

CREATE TABLE IF NOT EXISTS "presence_settings" (
  "tenantId" TEXT NOT NULL,
  "idleTimeoutSeconds" INTEGER NOT NULL DEFAULT 120,
  "heartbeatIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  CONSTRAINT "presence_settings_pkey" PRIMARY KEY ("tenantId")
);

-- Extend RR queues for project-scoped SVC/Sales routing and GRE handoff safety.
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "RRQueue" ADD COLUMN IF NOT EXISTS "userType" TEXT NOT NULL DEFAULT 'SALES';
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "userType" TEXT NOT NULL DEFAULT 'SALES';
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "isWorking" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "weekOff" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "RRQueueMember" ADD COLUMN IF NOT EXISTS "lastAssignedAt" TIMESTAMP(3);

ALTER TABLE "SiteVisit" ADD COLUMN IF NOT EXISTS "salesHandoffAt" TIMESTAMP(3);
ALTER TABLE "SiteVisit" ADD COLUMN IF NOT EXISTS "salesHandoffQueueId" TEXT;
ALTER TABLE "SiteVisit" ADD COLUMN IF NOT EXISTS "salesHandoffPendingReason" TEXT;

DO $$ BEGIN
  ALTER TABLE "RRQueue" ADD CONSTRAINT "RRQueue_project_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "RRQueue_tenant_project_userType_key"
  ON "RRQueue"("tenantId", "projectId", "userType");
CREATE INDEX IF NOT EXISTS "RRQueue_project_userType_active_idx"
  ON "RRQueue"("tenantId", "projectId", "userType", "active");
CREATE INDEX IF NOT EXISTS "RRQueueMember_eligibility_idx"
  ON "RRQueueMember"("rrQueueId", "userType", "activeMember", "isAvailable", "isWorking", "weekOff");
CREATE INDEX IF NOT EXISTS "SiteVisit_pending_handoff_idx"
  ON "SiteVisit"("tenantId", "salesHandoffAt");

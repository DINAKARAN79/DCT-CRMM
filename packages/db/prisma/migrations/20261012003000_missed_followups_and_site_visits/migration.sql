ALTER TYPE "SiteVisitStatus" ADD VALUE 'MISSED';

ALTER TABLE "SiteVisit"
ADD COLUMN "missedAt" TIMESTAMP(3);

ALTER TABLE "FollowUp"
ADD COLUMN "isMissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "missedAt" TIMESTAMP(3);

CREATE INDEX "FollowUp_tenantId_isCompleted_isMissed_dueDate_idx"
ON "FollowUp"("tenantId", "isCompleted", "isMissed", "dueDate");

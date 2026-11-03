ALTER TABLE "CallDetail"
ADD COLUMN "name" VARCHAR(255),
ADD COLUMN "callFrom" VARCHAR(255),
ADD COLUMN "callId" VARCHAR(255),
ADD COLUMN "callTo" VARCHAR(50),
ADD COLUMN "caseId" TEXT,
ADD COLUMN "duration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "executiveContactNo" VARCHAR(50),
ADD COLUMN "landingNumber" VARCHAR(255),
ADD COLUMN "lastModifiedById" TEXT,
ADD COLUMN "opportunityId" TEXT,
ADD COLUMN "ownerId" TEXT,
ADD COLUMN "parentId" VARCHAR(100),
ADD COLUMN "parentUrl" VARCHAR(255),
ADD COLUMN "recordingFile" VARCHAR(255),
ADD COLUMN "status" VARCHAR(50) NOT NULL DEFAULT 'COMPLETED';

UPDATE "CallDetail"
SET
  "name" = 'CALL-' || UPPER(SUBSTRING("id" FROM 1 FOR 12)),
  "callId" = "id",
  "lastModifiedById" = "createdById",
  "ownerId" = "createdById",
  "parentId" = "leadId";

ALTER TABLE "CallDetail"
ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "callId" SET NOT NULL;

CREATE UNIQUE INDEX "CallDetail_callId_key" ON "CallDetail"("callId");
CREATE UNIQUE INDEX "CallDetail_tenantId_name_key" ON "CallDetail"("tenantId", "name");
CREATE INDEX "CallDetail_tenantId_opportunityId_idx" ON "CallDetail"("tenantId", "opportunityId");
CREATE INDEX "CallDetail_caseId_idx" ON "CallDetail"("caseId");
CREATE INDEX "CallDetail_lastModifiedById_idx" ON "CallDetail"("lastModifiedById");
CREATE INDEX "CallDetail_ownerId_idx" ON "CallDetail"("ownerId");

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_caseId_fkey"
FOREIGN KEY ("caseId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_opportunityId_fkey"
FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_lastModifiedById_fkey"
FOREIGN KEY ("lastModifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CallDetail" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CallDetail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallDetail_tenantId_leadId_startAt_idx"
ON "CallDetail"("tenantId", "leadId", "startAt");

CREATE INDEX "CallDetail_createdById_idx"
ON "CallDetail"("createdById");

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CallDetail"
ADD CONSTRAINT "CallDetail_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CallDetail"
ALTER COLUMN "leadId" DROP NOT NULL;

ALTER TABLE "CallDetail"
ADD COLUMN "answeredAt" TIMESTAMP(3);

CREATE INDEX "CallDetail_tenantId_createdById_startAt_idx"
ON "CallDetail"("tenantId", "createdById", "startAt");

CREATE INDEX "CallDetail_tenantId_createdById_providerCallId_idx"
ON "CallDetail"("tenantId", "createdById", "providerCallId");

ALTER TABLE "telephony_settings"
ADD COLUMN IF NOT EXISTS "sendTenantIdInDial" BOOLEAN NOT NULL DEFAULT true;

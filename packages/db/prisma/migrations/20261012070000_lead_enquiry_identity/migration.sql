ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'FACEBOOK';

ALTER TABLE "Lead"
  ADD COLUMN "firstCampaign" TEXT,
  ADD COLUMN "lastEnquiryAt" TIMESTAMP(3),
  ADD COLUMN "enquiryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tertiaryEmail" TEXT;

ALTER TABLE "Enquiry"
  ADD COLUMN "tertiaryEmail" TEXT,
  ADD COLUMN "originalSubmissionId" TEXT;

DROP INDEX IF EXISTS "Lead_tenantId_phone_key";
CREATE INDEX IF NOT EXISTS "Lead_tenantId_phone_idx" ON "Lead"("tenantId", "phone");

CREATE UNIQUE INDEX "Enquiry_tenantId_originalSubmissionId_key"
  ON "Enquiry"("tenantId", "originalSubmissionId");

BEGIN;

CREATE TABLE IF NOT EXISTS "Enquiry" (
  "id" TEXT NOT NULL,
  "enquiryNumber" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "leadType" TEXT NOT NULL,
  "enquiryType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "subSource" TEXT,
  "campaignId" TEXT,
  "campaign" TEXT,
  "subCampaignId" TEXT,
  "subCampaign" TEXT,
  "projectId" TEXT,
  "phone" TEXT,
  "secondaryPhone" TEXT,
  "tertiaryPhone" TEXT,
  "countryCode" TEXT,
  "secondaryCountryCode" TEXT,
  "email" TEXT,
  "secondaryEmail" TEXT,
  "medium" TEXT,
  "description" TEXT,
  "channelPartner" TEXT,
  "details" JSONB,
  "enquiryDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Enquiry_tenantId_enquiryNumber_key"
  ON "Enquiry" ("tenantId", "enquiryNumber");
CREATE INDEX IF NOT EXISTS "Enquiry_tenantId_leadId_createdAt_idx"
  ON "Enquiry" ("tenantId", "leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "Enquiry_tenantId_phone_idx"
  ON "Enquiry" ("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "Enquiry_tenantId_projectId_idx"
  ON "Enquiry" ("tenantId", "projectId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Enquiry_tenantId_fkey') THEN
    ALTER TABLE "Enquiry"
      ADD CONSTRAINT "Enquiry_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Enquiry_leadId_fkey') THEN
    ALTER TABLE "Enquiry"
      ADD CONSTRAINT "Enquiry_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Enquiry_projectId_fkey') THEN
    ALTER TABLE "Enquiry"
      ADD CONSTRAINT "Enquiry_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "Enquiry" (
  "id", "enquiryNumber", "tenantId", "leadId", "leadType", "enquiryType",
  "source", "subSource", "campaign", "subCampaign", "projectId", "phone",
  "secondaryPhone", "tertiaryPhone", "email", "secondaryEmail", "details",
  "enquiryDate", "createdById", "updatedById", "createdAt", "updatedAt"
)
SELECT
  legacy."id",
  'ENQ-LEGACY-' || legacy."id",
  legacy."tenantId",
  legacy."leadId",
  'Lead',
  legacy."type"::TEXT,
  legacy."source"::TEXT,
  legacy."subSource",
  legacy."campaign",
  legacy."subCampaign",
  legacy."projectId",
  legacy."phone",
  legacy."secondaryPhone",
  legacy."tertiaryPhone",
  legacy."email",
  legacy."secondaryEmail",
  legacy."details",
  legacy."createdAt",
  legacy."createdById",
  legacy."createdById",
  legacy."createdAt",
  legacy."createdAt"
FROM "LeadEnquiry" AS legacy
ON CONFLICT ("id") DO NOTHING;

COMMIT;

BEGIN;

CREATE TYPE "GreSessionStatus" AS ENUM (
  'STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE "Company" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "companyType" TEXT,
  "industry" "Industry",
  "email" TEXT,
  "phone" TEXT,
  "website" TEXT,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "country" TEXT,
  "postalCode" TEXT,
  "designation" TEXT,
  "department" TEXT,
  "numberOfEmployees" INTEGER,
  "gstNumber" TEXT,
  "normalizedGst" TEXT,
  "comments" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Lead" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "secondaryPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN "tertiaryPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN "alternateEmail" TEXT;
ALTER TABLE "Lead" ADD COLUMN "leadSubSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "campaign" TEXT;
ALTER TABLE "Lead" ADD COLUMN "leadType" TEXT;
ALTER TABLE "Lead" ADD COLUMN "preferredLocation" TEXT;
ALTER TABLE "Lead" ADD COLUMN "occupation" TEXT;
ALTER TABLE "Lead" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "gender" TEXT;
ALTER TABLE "Lead" ADD COLUMN "companyType" TEXT;
ALTER TABLE "Lead" ADD COLUMN "companyEmail" TEXT;
ALTER TABLE "Lead" ADD COLUMN "companyPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN "designation" TEXT;
ALTER TABLE "Lead" ADD COLUMN "department" TEXT;
ALTER TABLE "Lead" ADD COLUMN "gstNumber" TEXT;
ALTER TABLE "Lead" ADD COLUMN "companyComments" TEXT;
ALTER TABLE "SiteVisit" ADD COLUMN "visitorCount" INTEGER;
ALTER TABLE "SiteVisit" ADD COLUMN "visitType" TEXT;
ALTER TABLE "SiteVisit" ADD COLUMN "transportRequired" BOOLEAN;

CREATE INDEX "Lead_tenantId_companyId_idx" ON "Lead"("tenantId", "companyId");
CREATE INDEX "Lead_tenantId_mobile_idx" ON "Lead"("tenantId", "mobile");
CREATE INDEX "Lead_tenantId_secondaryPhone_idx" ON "Lead"("tenantId", "secondaryPhone");
CREATE INDEX "Lead_tenantId_tertiaryPhone_idx" ON "Lead"("tenantId", "tertiaryPhone");

CREATE TABLE "GreForm" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "defaultProjectId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GreForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GreSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "phoneCountryCode" TEXT,
  "phone" TEXT,
  "normalizedPhone" TEXT,
  "leadId" TEXT,
  "siteVisitId" TEXT,
  "companyId" TEXT,
  "currentStep" INTEGER NOT NULL DEFAULT 1,
  "status" "GreSessionStatus" NOT NULL DEFAULT 'STARTED',
  "draft" JSONB,
  "referenceNumber" TEXT,
  "leadWasExisting" BOOLEAN,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GreSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_tenantId_normalizedName_key" ON "Company"("tenantId", "normalizedName");
CREATE UNIQUE INDEX "Company_tenantId_normalizedGst_key" ON "Company"("tenantId", "normalizedGst");
CREATE INDEX "Company_tenantId_name_idx" ON "Company"("tenantId", "name");
CREATE INDEX "Company_tenantId_phone_idx" ON "Company"("tenantId", "phone");
CREATE INDEX "Company_tenantId_email_idx" ON "Company"("tenantId", "email");

CREATE UNIQUE INDEX "GreForm_publicToken_key" ON "GreForm"("publicToken");
CREATE INDEX "GreForm_tenantId_isActive_idx" ON "GreForm"("tenantId", "isActive");
CREATE INDEX "GreForm_tenantId_createdAt_idx" ON "GreForm"("tenantId", "createdAt");

CREATE UNIQUE INDEX "GreSession_sessionTokenHash_key" ON "GreSession"("sessionTokenHash");
CREATE UNIQUE INDEX "GreSession_referenceNumber_key" ON "GreSession"("referenceNumber");
CREATE INDEX "GreSession_tenantId_normalizedPhone_idx" ON "GreSession"("tenantId", "normalizedPhone");
CREATE INDEX "GreSession_formId_status_createdAt_idx" ON "GreSession"("formId", "status", "createdAt");
CREATE INDEX "GreSession_leadId_idx" ON "GreSession"("leadId");

ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GreForm" ADD CONSTRAINT "GreForm_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GreSession" ADD CONSTRAINT "GreSession_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GreSession" ADD CONSTRAINT "GreSession_formId_fkey"
  FOREIGN KEY ("formId") REFERENCES "GreForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GreSession" ADD CONSTRAINT "GreSession_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GreSession" ADD CONSTRAINT "GreSession_siteVisitId_fkey"
  FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GreSession" ADD CONSTRAINT "GreSession_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

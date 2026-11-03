-- Phone numbers can be shared. Duplicate review is enforced by the CRM matching workflow.
DROP INDEX IF EXISTS "Lead_tenantId_phone_key";
CREATE INDEX IF NOT EXISTS "Lead_tenantId_phone_idx" ON "Lead"("tenantId", "phone");

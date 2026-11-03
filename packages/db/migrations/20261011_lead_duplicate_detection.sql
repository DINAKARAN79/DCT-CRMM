ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "secondaryCountryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "tertiaryCountryCode" TEXT;

ALTER TABLE "Enquiry"
  ADD COLUMN IF NOT EXISTS "tertiaryCountryCode" TEXT;

CREATE INDEX IF NOT EXISTS "Lead_tenant_phone_digits_idx"
  ON "Lead" ("tenantId", (regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Lead_tenant_mobile_digits_idx"
  ON "Lead" ("tenantId", (regexp_replace(coalesce("mobile", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Lead_tenant_secondary_phone_digits_idx"
  ON "Lead" ("tenantId", (regexp_replace(coalesce("secondaryPhone", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Lead_tenant_tertiary_phone_digits_idx"
  ON "Lead" ("tenantId", (regexp_replace(coalesce("tertiaryPhone", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Lead_tenant_email_normalized_idx"
  ON "Lead" ("tenantId", (lower(btrim(coalesce("email", '')))));
CREATE INDEX IF NOT EXISTS "Lead_tenant_secondary_email_normalized_idx"
  ON "Lead" ("tenantId", (lower(btrim(coalesce("secondaryEmail", '')))));
CREATE INDEX IF NOT EXISTS "Lead_tenant_alternate_email_normalized_idx"
  ON "Lead" ("tenantId", (lower(btrim(coalesce("alternateEmail", '')))));

CREATE INDEX IF NOT EXISTS "Enquiry_tenant_phone_digits_idx"
  ON "Enquiry" ("tenantId", (regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Enquiry_tenant_secondary_phone_digits_idx"
  ON "Enquiry" ("tenantId", (regexp_replace(coalesce("secondaryPhone", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Enquiry_tenant_tertiary_phone_digits_idx"
  ON "Enquiry" ("tenantId", (regexp_replace(coalesce("tertiaryPhone", ''), '[^0-9]', '', 'g')));
CREATE INDEX IF NOT EXISTS "Enquiry_tenant_email_normalized_idx"
  ON "Enquiry" ("tenantId", (lower(btrim(coalesce("email", '')))));
CREATE INDEX IF NOT EXISTS "Enquiry_tenant_secondary_email_normalized_idx"
  ON "Enquiry" ("tenantId", (lower(btrim(coalesce("secondaryEmail", '')))));

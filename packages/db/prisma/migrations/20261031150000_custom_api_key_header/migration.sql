ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "customHeaderName" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptOnlyCustomHeader" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "api_key_request_logs"
  ALTER COLUMN "apiKeyId" DROP NOT NULL,
  ALTER COLUMN "tenantId" DROP NOT NULL;

UPDATE "api_keys"
SET "scopes" = ARRAY(
  SELECT DISTINCT scope
  FROM unnest("scopes" || ARRAY[
    'quotations:read', 'quotations:write',
    'receipts:read', 'receipts:write',
    'records:read', 'records:write',
    'notes:read', 'notes:write'
  ]::TEXT[]) AS scope_values(scope)
  ORDER BY scope
);

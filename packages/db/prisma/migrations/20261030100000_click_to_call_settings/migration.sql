CREATE TABLE IF NOT EXISTS "telephony_settings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL DEFAULT 'https://bizcall.cxteletech.com',
  "authHeaderName" TEXT NOT NULL DEFAULT 'Authorization',
  "useBearerPrefix" BOOLEAN NOT NULL DEFAULT true,
  "callIdFieldPath" TEXT NOT NULL DEFAULT '',
  "encryptedCredentials" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "telephony_settings_tenantId_key" ON "telephony_settings"("tenantId");

ALTER TABLE "CallDetail" ADD COLUMN IF NOT EXISTS "providerCallId" VARCHAR(255);
ALTER TABLE "CallDetail" ADD COLUMN IF NOT EXISTS "providerResponse" JSONB;

INSERT INTO "Permission" ("id", "name", "label", "module", "action", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  'perm_telephony_call',
  'TELEPHONY_CALL',
  'Click to call',
  'TELEPHONY',
  'CALL',
  'Place an outbound click-to-call from a lead',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE SET
  "isActive" = true,
  "label" = EXCLUDED."label",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action";

INSERT INTO "UserProfilePermission" ("id", "profileId", "permissionId", "createdAt")
SELECT 'upp_telephony_' || p."id", p."id", perm."id", CURRENT_TIMESTAMP
FROM "Profile" p
CROSS JOIN "Permission" perm
WHERE perm."name" = 'TELEPHONY_CALL'
  AND (
    p."isAdmin" = true
    OR p."name" ~* '^(system administrator|admin|sales|pre[[:space:]-]?sales)([[:space:]]|$)'
  )
ON CONFLICT ("profileId", "permissionId") DO NOTHING;

INSERT INTO "Permission" (
  "id", "name", "label", "module", "action", "description", "isActive", "createdAt", "updatedAt"
)
SELECT
  'perm_telephony_call', 'TELEPHONY_CALL', 'Click to call', 'TELEPHONY', 'CALL',
  'Place an outbound click-to-call from a lead', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Permission" WHERE "name" = 'TELEPHONY_CALL'
)
ON CONFLICT ("name") DO UPDATE SET "isActive" = true;

INSERT INTO "UserProfilePermission" ("id", "profileId", "permissionId", "createdAt")
SELECT
  'upp_telephony_' || p."id", p."id", perm."id", CURRENT_TIMESTAMP
FROM "Profile" p
CROSS JOIN "Permission" perm
WHERE perm."name" = 'TELEPHONY_CALL'
  AND (
    p."isAdmin" = true
    OR p."name" ~* '^(system administrator|admin|sales|pre[[:space:]-]?sales)([[:space:]]|$)'
  )
ON CONFLICT ("profileId", "permissionId") DO NOTHING;

INSERT INTO "telephony_settings" (
  "id", "tenantId", "clickToCallUrl", "authHeaderName", "useBearerPrefix",
  "noAuthRequired", "allowTestUrl", "callIdFieldPath", "isActive",
  "dialpadUrl", "dialpadMode", "callMethod", "defaultDockState", "theme",
  "duplicateGuardSeconds", "callsPerMinute", "maskNumbers", "blockDnc", "dncNumbers",
  "createdAt", "updatedAt"
)
SELECT
  'telephony_default_' || t."id", t."id",
  'https://bizcall.cxteletech.com/api/integration/click2call',
  'X-API-KEY', false, false, false, 'originateUuid', false,
  'https://bizcall.cxteletech.com/embed/dialpad',
  'DOCKED', 'SERVER_API', 'COLLAPSED', 'CRM', 10, 10, false, false, '',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Tenant" t
ON CONFLICT ("tenantId") DO NOTHING;

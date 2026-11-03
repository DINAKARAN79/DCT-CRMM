BEGIN;

SELECT pg_advisory_xact_lock(hashtext('dct-crm-telephony-permission-repair'));

DO $$
DECLARE
  missing_tables integer;
BEGIN
  IF to_regclass('public."Permission"') IS NULL
    OR to_regclass('public."Profile"') IS NULL
    OR to_regclass('public."UserProfilePermission"') IS NULL
    OR to_regclass('public."Tenant"') IS NULL
    OR to_regclass('public."CallDetail"') IS NULL
    OR to_regclass('public."User"') IS NULL THEN
    RAISE EXCEPTION 'Telephony repair requires public."Permission", public."Profile", public."UserProfilePermission", public."Tenant", public."User", and public."CallDetail". No changes were committed.';
  END IF;

  SELECT count(*) INTO missing_tables
  FROM (VALUES
    ('telephony_settings'),
    ('telephony_agent_permissions'),
    ('telephony_integrations'),
    ('telephony_call_receipts'),
    ('telephony_request_logs'),
    ('api_keys'),
    ('api_key_request_logs'),
    ('user_sessions'),
    ('presence_settings')
  ) AS expected(table_name)
  WHERE to_regclass(format('public.%I', expected.table_name)) IS NULL;
  RAISE NOTICE 'Tables absent before repair: % of 9', missing_tables;
END $$;

CREATE TABLE IF NOT EXISTS public.telephony_settings (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clickToCallUrl" TEXT NOT NULL DEFAULT 'https://bizcall.cxteletech.com/api/integration/click2call',
  "authHeaderName" TEXT NOT NULL DEFAULT 'X-API-KEY',
  "useBearerPrefix" BOOLEAN NOT NULL DEFAULT false,
  "noAuthRequired" BOOLEAN NOT NULL DEFAULT false,
  "allowTestUrl" BOOLEAN NOT NULL DEFAULT false,
  "callIdFieldPath" TEXT NOT NULL DEFAULT 'originateUuid',
  "callerId" TEXT,
  "encryptedCredentials" TEXT,
  "keyLast4" TEXT,
  "encryptedExtraHeaders" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" TEXT,
  "dialpadUrl" TEXT NOT NULL DEFAULT 'https://bizcall.cxteletech.com/embed/dialpad',
  "dialpadMode" TEXT NOT NULL DEFAULT 'DOCKED',
  "callMethod" TEXT NOT NULL DEFAULT 'SERVER_API',
  "defaultDockState" TEXT NOT NULL DEFAULT 'COLLAPSED',
  "theme" TEXT NOT NULL DEFAULT 'CRM',
  "productionOrigin" TEXT,
  "duplicateGuardSeconds" INTEGER NOT NULL DEFAULT 10,
  "callsPerMinute" INTEGER NOT NULL DEFAULT 10,
  "maskNumbers" BOOLEAN NOT NULL DEFAULT false,
  "sendTenantIdInDial" BOOLEAN NOT NULL DEFAULT true,
  "blockDnc" BOOLEAN NOT NULL DEFAULT false,
  "dncNumbers" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.telephony_settings
  ADD COLUMN IF NOT EXISTS "clickToCallUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "authHeaderName" TEXT NOT NULL DEFAULT 'X-API-KEY',
  ADD COLUMN IF NOT EXISTS "useBearerPrefix" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "noAuthRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowTestUrl" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "callIdFieldPath" TEXT NOT NULL DEFAULT 'originateUuid',
  ADD COLUMN IF NOT EXISTS "callerId" TEXT,
  ADD COLUMN IF NOT EXISTS "encryptedCredentials" TEXT,
  ADD COLUMN IF NOT EXISTS "keyLast4" TEXT,
  ADD COLUMN IF NOT EXISTS "encryptedExtraHeaders" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT,
  ADD COLUMN IF NOT EXISTS "dialpadUrl" TEXT NOT NULL DEFAULT 'https://bizcall.cxteletech.com/embed/dialpad',
  ADD COLUMN IF NOT EXISTS "dialpadMode" TEXT NOT NULL DEFAULT 'DOCKED',
  ADD COLUMN IF NOT EXISTS "callMethod" TEXT NOT NULL DEFAULT 'SERVER_API',
  ADD COLUMN IF NOT EXISTS "defaultDockState" TEXT NOT NULL DEFAULT 'COLLAPSED',
  ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'CRM',
  ADD COLUMN IF NOT EXISTS "productionOrigin" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicateGuardSeconds" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "callsPerMinute" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "maskNumbers" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sendTenantIdInDial" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "blockDnc" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dncNumbers" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'telephony_settings'
      AND column_name = 'baseUrl'
  ) THEN
    EXECUTE $sql$
      UPDATE public.telephony_settings
      SET "clickToCallUrl" = CASE
        WHEN "baseUrl" IS NULL OR btrim("baseUrl") = ''
          THEN 'https://bizcall.cxteletech.com/api/integration/click2call'
        WHEN regexp_replace(rtrim("baseUrl"), '/+$', '') ~* '/api/(dialer/)?click2call$'
          THEN regexp_replace(rtrim("baseUrl"), '/+$', '')
        ELSE regexp_replace(rtrim("baseUrl"), '/+$', '') || '/api/integration/click2call'
      END
      WHERE "clickToCallUrl" IS NULL OR btrim("clickToCallUrl") = ''
    $sql$;
  END IF;
END $$;

UPDATE public.telephony_settings
SET "clickToCallUrl" = 'https://bizcall.cxteletech.com/api/integration/click2call'
WHERE "clickToCallUrl" IS NULL OR btrim("clickToCallUrl") = '';

ALTER TABLE public.telephony_settings
  ALTER COLUMN "clickToCallUrl" SET DEFAULT 'https://bizcall.cxteletech.com/api/integration/click2call',
  ALTER COLUMN "clickToCallUrl" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_settings_tenantId_key"
  ON public.telephony_settings("tenantId");

CREATE TABLE IF NOT EXISTS public.telephony_agent_permissions (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "canUse" BOOLEAN NOT NULL,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_agent_permissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "telephony_agent_permissions_tenantId_userId_key" UNIQUE ("tenantId", "userId")
);
ALTER TABLE public.telephony_agent_permissions
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "canUse" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_agent_permissions_tenantId_userId_key"
  ON public.telephony_agent_permissions("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "telephony_agent_permissions_tenantId_idx"
  ON public.telephony_agent_permissions("tenantId");

CREATE TABLE IF NOT EXISTS public.telephony_integrations (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_integrations_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public.telephony_integrations
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT,
  ADD COLUMN IF NOT EXISTS "keyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_integrations_keyHash_key"
  ON public.telephony_integrations("keyHash");
CREATE INDEX IF NOT EXISTS "telephony_integrations_tenantId_idx"
  ON public.telephony_integrations("tenantId");
CREATE INDEX IF NOT EXISTS "telephony_integrations_tenantId_revokedAt_idx"
  ON public.telephony_integrations("tenantId", "revokedAt");

CREATE TABLE IF NOT EXISTS public.telephony_call_receipts (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "providerCallId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "callDetailId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_call_receipts_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public.telephony_call_receipts
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "integrationId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerCallId" TEXT,
  ADD COLUMN IF NOT EXISTS "leadId" TEXT,
  ADD COLUMN IF NOT EXISTS "callDetailId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "telephony_call_receipts_tenantId_providerCallId_key"
  ON public.telephony_call_receipts("tenantId", "providerCallId");
CREATE INDEX IF NOT EXISTS "telephony_call_receipts_integrationId_idx"
  ON public.telephony_call_receipts("integrationId");
CREATE INDEX IF NOT EXISTS "telephony_call_receipts_leadId_idx"
  ON public.telephony_call_receipts("leadId");

CREATE TABLE IF NOT EXISTS public.telephony_request_logs (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leadId" TEXT,
  "maskedNumber" TEXT,
  "step" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "httpStatus" INTEGER,
  "durationMs" INTEGER,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_request_logs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public.telephony_request_logs
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "leadId" TEXT,
  ADD COLUMN IF NOT EXISTS "maskedNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "step" TEXT,
  ADD COLUMN IF NOT EXISTS "code" TEXT,
  ADD COLUMN IF NOT EXISTS "httpStatus" INTEGER,
  ADD COLUMN IF NOT EXISTS "durationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "telephony_request_logs_tenantId_createdAt_idx"
  ON public.telephony_request_logs("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS public.api_keys (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "publicId" TEXT,
  "keyHash" TEXT NOT NULL,
  "encryptedKey" TEXT,
  "keyIv" TEXT,
  "keyTag" TEXT,
  "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "needsRegenerate" BOOLEAN NOT NULL DEFAULT false,
  "revealedToCompanyAdminAt" TIMESTAMP(3),
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customHeaderName" TEXT,
  "acceptOnlyCustomHeader" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
  "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "graceUntil" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT,
  ADD COLUMN IF NOT EXISTS "publicId" TEXT,
  ADD COLUMN IF NOT EXISTS "keyHash" TEXT,
  ADD COLUMN IF NOT EXISTS "encryptedKey" TEXT,
  ADD COLUMN IF NOT EXISTS "keyIv" TEXT,
  ADD COLUMN IF NOT EXISTS "keyTag" TEXT,
  ADD COLUMN IF NOT EXISTS "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "needsRegenerate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "revealedToCompanyAdminAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "customHeaderName" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptOnlyCustomHeader" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "ipAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "lastUsedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "graceUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_keyHash_key" ON public.api_keys("keyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_publicId_key" ON public.api_keys("publicId");
CREATE INDEX IF NOT EXISTS "api_keys_tenantId_idx" ON public.api_keys("tenantId");
CREATE INDEX IF NOT EXISTS "api_keys_tenantId_revokedAt_idx" ON public.api_keys("tenantId", "revokedAt");
CREATE INDEX IF NOT EXISTS "api_keys_keyPrefix_idx" ON public.api_keys("keyPrefix");

CREATE TABLE IF NOT EXISTS public.api_key_request_logs (
  "id" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "tenantId" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_key_request_logs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public.api_key_request_logs
  ADD COLUMN IF NOT EXISTS "apiKeyId" TEXT,
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "method" TEXT,
  ADD COLUMN IF NOT EXISTS "path" TEXT,
  ADD COLUMN IF NOT EXISTS "status" INTEGER,
  ADD COLUMN IF NOT EXISTS "durationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "api_key_request_logs_tenantId_createdAt_idx"
  ON public.api_key_request_logs("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS public.user_sessions (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "browser" TEXT,
  "os" TEXT,
  "deviceType" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  "isImpersonation" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT,
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "browser" TEXT,
  ADD COLUMN IF NOT EXISTS "os" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceType" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endReason" TEXT,
  ADD COLUMN IF NOT EXISTS "isImpersonation" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "user_sessions_sessionTokenHash_key"
  ON public.user_sessions("sessionTokenHash");
CREATE INDEX IF NOT EXISTS "user_sessions_tenantId_userId_endedAt_idx"
  ON public.user_sessions("tenantId", "userId", "endedAt");
CREATE INDEX IF NOT EXISTS "user_sessions_tenantId_lastSeenAt_idx"
  ON public.user_sessions("tenantId", "lastSeenAt");

CREATE TABLE IF NOT EXISTS public.presence_settings (
  "tenantId" TEXT NOT NULL,
  "idleTimeoutSeconds" INTEGER NOT NULL DEFAULT 120,
  "heartbeatIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  CONSTRAINT "presence_settings_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE public.presence_settings
  ADD COLUMN IF NOT EXISTS "idleTimeoutSeconds" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "heartbeatIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS "isLoggedIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastLogoutAt" TIMESTAMP(3);

ALTER TABLE public."CallDetail"
  ADD COLUMN IF NOT EXISTS "answeredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "providerCallId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "providerResponse" JSONB,
  ADD COLUMN IF NOT EXISTS "disposition" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "source" VARCHAR(40);
CREATE INDEX IF NOT EXISTS "CallDetail_tenantId_createdById_startAt_idx"
  ON public."CallDetail"("tenantId", "createdById", "startAt");
CREATE INDEX IF NOT EXISTS "CallDetail_tenantId_createdById_providerCallId_idx"
  ON public."CallDetail"("tenantId", "createdById", "providerCallId");

DO $$
DECLARE
  inserted_count integer;
BEGIN
  INSERT INTO public."Permission" (
    "id", "name", "label", "module", "action", "description", "isActive", "createdAt", "updatedAt"
  )
  VALUES (
    'perm_telephony_call', 'TELEPHONY_CALL', 'Click to call', 'TELEPHONY', 'CALL',
    'Place an outbound click-to-call from a lead', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("name") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF NOT EXISTS (SELECT 1 FROM public."Permission" WHERE "name" = 'TELEPHONY_CALL') THEN
    RAISE EXCEPTION 'Could not create public."Permission"."name" = TELEPHONY_CALL; resolve the conflicting permission ID and retry.';
  END IF;
  RAISE NOTICE 'Permission rows inserted: %', inserted_count;
END $$;

DO $$
DECLARE
  inserted_count integer;
BEGIN
  INSERT INTO public."UserProfilePermission" ("id", "profileId", "permissionId", "createdAt")
  SELECT
    'upp_telephony_' || md5(p."id" || ':' || permission."id"),
    p."id",
    permission."id",
    CURRENT_TIMESTAMP
  FROM public."Profile" p
  CROSS JOIN public."Permission" permission
  WHERE permission."name" = 'TELEPHONY_CALL'
    AND (
      p."isAdmin" = true
      OR p."name" ~* '^(system administrator|admin|sales|pre[[:space:]-]?sales)([[:space:]]|$)'
    )
  ON CONFLICT ("profileId", "permissionId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'Profile permission grants inserted: %', inserted_count;
END $$;

DO $$
DECLARE
  inserted_count integer;
BEGIN
  INSERT INTO public.telephony_settings (
    "id", "tenantId", "clickToCallUrl", "authHeaderName", "useBearerPrefix",
    "noAuthRequired", "allowTestUrl", "callIdFieldPath", "isActive",
    "dialpadUrl", "dialpadMode", "callMethod", "defaultDockState", "theme",
    "duplicateGuardSeconds", "callsPerMinute", "maskNumbers", "sendTenantIdInDial",
    "blockDnc", "dncNumbers", "createdAt", "updatedAt"
  )
  SELECT
    'telephony_default_' || md5(t."id"),
    t."id",
    'https://bizcall.cxteletech.com/api/integration/click2call',
    'X-API-KEY',
    false,
    false,
    false,
    'originateUuid',
    false,
    'https://bizcall.cxteletech.com/embed/dialpad',
    'DOCKED',
    'SERVER_API',
    'COLLAPSED',
    'CRM',
    10,
    10,
    false,
    true,
    false,
    '',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM public."Tenant" t
  ON CONFLICT ("tenantId") DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RAISE NOTICE 'Inactive tenant settings rows inserted: %', inserted_count;
END $$;

COMMIT;

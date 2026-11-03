\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
\echo 'Telephony permission database check (no secrets are selected)'

SELECT
  to_regclass('public."Permission"') IS NOT NULL AS permission_table_present,
  to_regclass('public."Profile"') IS NOT NULL AS profile_table_present,
  to_regclass('public."UserProfilePermission"') IS NOT NULL AS profile_permission_table_present,
  to_regclass('public."Tenant"') IS NOT NULL AS tenant_table_present,
  to_regclass('public.telephony_settings') IS NOT NULL AS telephony_settings_present
\gset

\echo ''
\echo 'Required catalog and settings tables'
SELECT
  :'permission_table_present' AS permission_table_present,
  :'profile_table_present' AS profile_table_present,
  :'profile_permission_table_present' AS profile_permission_table_present,
  :'tenant_table_present' AS tenant_table_present,
  :'telephony_settings_present' AS telephony_settings_present;

\echo ''
\echo 'Permission catalog'
\if :permission_table_present
  SELECT p."id", p."name", p."module", p."action", p."isActive"
  FROM public."Permission" p
  WHERE p."name" = 'TELEPHONY_CALL';
\else
  \echo 'public."Permission" table is missing.'
\endif

\echo ''
\echo 'PostgreSQL enum labels named TELEPHONY_CALL (the application currently uses a Permission row)'
SELECT n.nspname AS schema_name, t.typname AS enum_type
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE e.enumlabel = 'TELEPHONY_CALL'
ORDER BY n.nspname, t.typname;

\echo ''
\echo 'Profiles and TELEPHONY_CALL profile grant'
SELECT
  to_regclass('public."Permission"') IS NOT NULL
  AND to_regclass('public."Profile"') IS NOT NULL
  AND to_regclass('public."UserProfilePermission"') IS NOT NULL AS profile_grants_checkable
\gset
\if :profile_grants_checkable
  SELECT
    p."tenantId",
    p."name" AS profile_name,
    p."isAdmin",
    (permission."id" IS NOT NULL AND upp."id" IS NOT NULL) AS has_telephony_call
  FROM public."Profile" p
  LEFT JOIN public."Permission" permission
    ON permission."name" = 'TELEPHONY_CALL'
  LEFT JOIN public."UserProfilePermission" upp
    ON upp."profileId" = p."id"
   AND upp."permissionId" = permission."id"
  ORDER BY p."tenantId", p."name";
\else
  \echo 'Required permission/profile tables are missing; profile grants cannot be listed.'
\endif

\echo ''
\echo 'Tenants with no telephony_settings row'
\if :tenant_table_present
  \if :telephony_settings_present
    SELECT t."id" AS tenant_id, t."name" AS tenant_name
    FROM public."Tenant" t
    LEFT JOIN public.telephony_settings settings
      ON settings."tenantId" = t."id"
    WHERE settings."tenantId" IS NULL
    ORDER BY t."name";
  \else
    \echo 'public.telephony_settings is missing; all tenants currently have no settings row.'
    SELECT "id" AS tenant_id, "name" AS tenant_name
    FROM public."Tenant"
    ORDER BY "name";
  \endif
\else
  \echo 'public."Tenant" table is missing; tenants cannot be listed.'
\endif

\echo ''
\if :permission_table_present
  SELECT EXISTS (
    SELECT 1 FROM public."Permission" WHERE "name" = 'TELEPHONY_CALL'
  ) AS telephony_permission_exists
  \gset
  \if :telephony_permission_exists
    \echo 'PASS: public."Permission"."name" = TELEPHONY_CALL exists.'
  \else
    \echo 'FAIL: public."Permission"."name" = TELEPHONY_CALL is missing; run scripts/repair-telephony-permission.sql.'
    DO $$ BEGIN RAISE EXCEPTION 'Missing public."Permission"."name" = TELEPHONY_CALL; run scripts/repair-telephony-permission.sql.'; END $$;
  \endif
\else
  \echo 'FAIL: public."Permission" table is missing; run scripts/repair-telephony-permission.sql.'
  DO $$ BEGIN RAISE EXCEPTION 'Missing public."Permission" table; run scripts/repair-telephony-permission.sql.'; END $$;
\endif

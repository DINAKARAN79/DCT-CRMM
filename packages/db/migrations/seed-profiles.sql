-- ============================================================
-- Seed CRM Profiles, Roles, and PermissionSets
-- This script seeds 9 CRM profiles with their lead status access,
-- creates roles, links them via UserRole, and creates
-- PermissionSets for each profile-role combination on the Lead object.
-- ============================================================

-- Use DO blocks with IF NOT EXISTS for idempotent execution.

-- ============================================================
-- 1. PROFILES with leadStatusAccess JSON
-- ============================================================

-- 1.1 Marketing Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant with slug dct-re not found';
  END IF;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Marketing',
    'Marketing team profile - handles NEW and INCOMING leads',
    false,
    '{"statuses": ["NEW", "INCOMING"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.2 Presales Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Presales',
    'Presales team profile - handles NEW and INCOMING leads',
    false,
    '{"statuses": ["NEW", "INCOMING"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.3 SVC Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'SVC',
    'Site Visit Coordinator profile - handles PROSPECT and SITE_VISIT_SCHEDULED leads',
    false,
    '{"statuses": ["PROSPECT", "SITE_VISIT_SCHEDULED"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.4 Sales Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Sales',
    'Sales team profile - handles SITE_VISIT_SCHEDULED and SITE_VISIT_HAPPENED leads',
    false,
    '{"statuses": ["SITE_VISIT_SCHEDULED", "SITE_VISIT_HAPPENED"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.5 CRM Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'CRM',
    'CRM team profile - handles SITE_VISIT_HAPPENED leads',
    false,
    '{"statuses": ["SITE_VISIT_HAPPENED"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.7 Recovery Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Recovery',
    'Recovery team profile - handles LOST leads',
    false,
    '{"statuses": ["LOST"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.8 Manager Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Manager',
    'Manager profile - access to all lead statuses',
    false,
    '{"statuses": ["NEW", "INCOMING", "PROSPECT", "SITE_VISIT_SCHEDULED", "SITE_VISIT_HAPPENED", "LOST"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 1.9 Admin Profile
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Profile" ("id", "tenantId", "name", "description", "isDefault", "leadStatusAccess", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'CRM Admin',
    'CRM Admin profile - full access to all lead statuses',
    false,
    '{"statuses": ["NEW", "INCOMING", "PROSPECT", "SITE_VISIT_SCHEDULED", "SITE_VISIT_HAPPENED", "LOST"]}'::jsonb,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- ============================================================
-- 2. ROLES (create new ones, skip existing)
-- ============================================================

-- 2.1 Marketing Role
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Marketing Executive',
    'Handles marketing and lead generation activities',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 2.2 Presales Role (already exists as 'Presales Executive', skip)
-- No action needed - 'Presales Executive' role already seeded.

-- 2.3 SVC Role
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Site Visit Coordinator',
    'Coordinates and manages site visits',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 2.4 Sales Role (already exists as 'Sales Executive', skip)
-- No action needed - 'Sales Executive' role already seeded.

-- 2.5 CRM Role
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'CRM Executive',
    'Manages CRM operations and lead tracking',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 2.6 Finance Role (already exists as 'Finance Manager', skip)
-- No action needed - 'Finance Manager' role already seeded.

-- 2.7 Recovery Role
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  INSERT INTO "Role" ("id", "tenantId", "name", "description", "isSystem", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    v_tenant_id,
    'Recovery Executive',
    'Handles lost lead recovery and re-engagement',
    true,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "name") DO NOTHING;
END $$;

-- 2.8 Manager Role (already exists as 'Sales Manager', skip)
-- No action needed - 'Sales Manager' role already seeded.

-- 2.9 Admin Role (already exists as 'Admin', skip)
-- No action needed - 'Admin' role already seeded.

-- ============================================================
-- 3. LINK PROFILES TO ROLES via UserRole (for existing seeded users)
-- ============================================================
-- Note: UserRole links Users to Roles, not Profiles to Roles directly.
-- Profiles are linked to users via User.profileId.
-- PermissionSets link Profiles to Roles via PermissionSetRole.
-- This section creates the UserRole assignments for new roles
-- and assigns the corresponding profiles to existing users.

-- 3.1 Assign Marketing profile to a user (if not already assigned)
-- This is a placeholder - in production you'd assign based on actual user needs.

-- ============================================================
-- 4. PERMISSION SETS for each Profile-Role on Lead object
-- ============================================================
-- Each profile gets a PermissionSet for the Lead object.
-- The PermissionSetRole links the PermissionSet to the Role.
-- Permissions vary by role level.

-- Helper function to create a PermissionSet with PermissionSetRole
CREATE OR REPLACE FUNCTION create_lead_permission_set(
  p_tenant_id TEXT,
  p_profile_name TEXT,
  p_role_name TEXT,
  p_set_name TEXT,
  p_permissions JSONB
) RETURNS VOID AS $$
DECLARE
  v_profile_id TEXT;
  v_role_id TEXT;
  v_perm_set_id TEXT;
BEGIN
  -- Get profile ID
  SELECT id INTO v_profile_id FROM "Profile"
  WHERE "tenantId" = p_tenant_id AND "name" = p_profile_name;

  IF v_profile_id IS NULL THEN
    RAISE WARNING 'Profile % not found, skipping permission set creation', p_profile_name;
    RETURN;
  END IF;

  -- Get role ID
  SELECT id INTO v_role_id FROM "Role"
  WHERE "tenantId" = p_tenant_id AND "name" = p_role_name;

  IF v_role_id IS NULL THEN
    RAISE WARNING 'Role % not found, skipping permission set creation', p_role_name;
    RETURN;
  END IF;

  -- Create PermissionSet (skip if exists)
  INSERT INTO "PermissionSet" ("id", "tenantId", "profileId", "name", "objectName", "permissions", "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    p_tenant_id,
    v_profile_id,
    p_set_name,
    'Lead',
    p_permissions,
    NOW(),
    NOW()
  )
  ON CONFLICT ("tenantId", "profileId", "objectName") DO NOTHING
  RETURNING id INTO v_perm_set_id;

  -- If the insert was skipped (conflict), get the existing ID
  IF v_perm_set_id IS NULL THEN
    SELECT id INTO v_perm_set_id FROM "PermissionSet"
    WHERE "tenantId" = p_tenant_id AND "profileId" = v_profile_id AND "objectName" = 'Lead';
  END IF;

  -- Link PermissionSet to Role (skip if exists)
  INSERT INTO "PermissionSetRole" ("id", "permissionSetId", "roleId", "createdAt")
  VALUES (
    gen_random_uuid()::text,
    v_perm_set_id,
    v_role_id,
    NOW()
  )
  ON CONFLICT ("permissionSetId", "roleId") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4.1 Marketing Profile + Marketing Executive Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'Marketing',
    'Marketing Executive',
    'Lead - Marketing Access',
    '{"create": true, "read": true, "edit": true, "delete": false, "viewAll": false, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.2 Presales Profile + Presales Executive Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'Presales',
    'Presales Executive',
    'Lead - Presales Access',
    '{"create": true, "read": true, "edit": true, "delete": false, "viewAll": false, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.3 SVC Profile + Site Visit Coordinator Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'SVC',
    'Site Visit Coordinator',
    'Lead - SVC Access',
    '{"create": false, "read": true, "edit": true, "delete": false, "viewAll": false, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.4 Sales Profile + Sales Executive Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'Sales',
    'Sales Executive',
    'Lead - Sales Access',
    '{"create": true, "read": true, "edit": true, "delete": false, "viewAll": false, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.5 CRM Profile + CRM Executive Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'CRM',
    'CRM Executive',
    'Lead - CRM Access',
    '{"create": true, "read": true, "edit": true, "delete": false, "viewAll": true, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.6 Finance Profile + Finance Manager Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'Finance',
    'Finance Manager',
    'Lead - Finance Access',
    '{"create": false, "read": true, "edit": false, "delete": false, "viewAll": true, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.7 Recovery Profile + Recovery Executive Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'Recovery',
    'Recovery Executive',
    'Lead - Recovery Access',
    '{"create": false, "read": true, "edit": true, "delete": false, "viewAll": false, "modifyAll": false}'::jsonb
  );
END $$;

-- ============================================================
-- 4.8 Manager Profile + Sales Manager Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'Manager',
    'Sales Manager',
    'Lead - Manager Access',
    '{"create": true, "read": true, "edit": true, "delete": true, "viewAll": true, "modifyAll": true}'::jsonb
  );
END $$;

-- ============================================================
-- 4.9 Admin Profile + Admin Role
-- ============================================================
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  SELECT id INTO v_tenant_id FROM "Tenant" WHERE slug = 'dct-re' LIMIT 1;

  PERFORM create_lead_permission_set(
    v_tenant_id,
    'CRM Admin',
    'Admin',
    'Lead - Admin Access',
    '{"create": true, "read": true, "edit": true, "delete": true, "viewAll": true, "modifyAll": true}'::jsonb
  );
END $$;

-- ============================================================
-- CLEANUP: Drop the helper function
-- ============================================================
DROP FUNCTION IF EXISTS create_lead_permission_set(TEXT, TEXT, TEXT, TEXT, JSONB);

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Verify profiles created
-- SELECT "name", "leadStatusAccess" FROM "Profile" WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'dct-re') ORDER BY "name";

-- Verify roles created
-- SELECT "name" FROM "Role" WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'dct-re') ORDER BY "name";

-- Verify PermissionSets created
-- SELECT ps."name", ps."objectName", ps."permissions", p."name" AS profile_name
-- FROM "PermissionSet" ps
-- JOIN "Profile" p ON ps."profileId" = p."id"
-- WHERE ps."objectName" = 'Lead'
-- ORDER BY p."name";

-- Verify PermissionSetRole links
-- SELECT psr."id", ps."name" AS permission_set, r."name" AS role
-- FROM "PermissionSetRole" psr
-- JOIN "PermissionSet" ps ON psr."permissionSetId" = ps."id"
-- JOIN "Role" r ON psr."roleId" = r."id"
-- WHERE ps."objectName" = 'Lead'
-- ORDER BY r."name";

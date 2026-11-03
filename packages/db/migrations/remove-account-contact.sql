-- ============================================================
-- Remove Account and Contact modules permanently
-- Idempotent: safe to run multiple times
-- ============================================================

-- 1. Drop Opportunity -> Account FK and column
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Opportunity' AND column_name = 'accountId') THEN
    EXECUTE 'ALTER TABLE "Opportunity" DROP CONSTRAINT IF EXISTS "Opportunity_accountId_fkey"';
    EXECUTE 'DROP INDEX IF EXISTS "Opportunity_accountId_idx"';
    EXECUTE 'ALTER TABLE "Opportunity" DROP COLUMN IF EXISTS "accountId"';
  END IF;
END $$;

-- 2. Drop Contact if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Contact') THEN
    EXECUTE 'ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_tenantId_fkey"';
    EXECUTE 'ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_leadId_fkey"';
    EXECUTE 'ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_accountId_fkey"';
    EXECUTE 'DROP INDEX IF EXISTS "Contact_tenantId_createdAt_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Contact_tenantId_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Contact_leadId_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Contact_accountId_idx"';
    EXECUTE 'DROP TABLE IF EXISTS "Contact"';
  END IF;
END $$;

-- 3. Drop Account if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Account') THEN
    EXECUTE 'ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_tenantId_fkey"';
    EXECUTE 'ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_ownerId_fkey"';
    EXECUTE 'ALTER TABLE "Account" DROP CONSTRAINT IF EXISTS "Account_parentAccountId_fkey"';
    EXECUTE 'DROP INDEX IF EXISTS "Account_tenantId_createdAt_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Account_tenantId_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Account_tenantId_name_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Account_tenantId_status_idx"';
    EXECUTE 'DROP INDEX IF EXISTS "Account_ownerId_idx"';
    EXECUTE 'DROP TABLE IF EXISTS "Account"';
  END IF;
END $$;

-- 4. Remove ACCOUNT_* / CONTACT_* permissions and assignments
DELETE FROM "UserProfilePermission" WHERE "permissionId" IN (
  SELECT id FROM "Permission" WHERE name LIKE 'ACCOUNT\_%' OR name LIKE 'CONTACT\_%' OR module IN ('ACCOUNT', 'CONTACT')
);
DELETE FROM "NewPermissionSetItem" WHERE "permissionId" IN (
  SELECT id FROM "Permission" WHERE name LIKE 'ACCOUNT\_%' OR name LIKE 'CONTACT\_%' OR module IN ('ACCOUNT', 'CONTACT')
);
DELETE FROM "UserDirectPermission" WHERE "permissionId" IN (
  SELECT id FROM "Permission" WHERE name LIKE 'ACCOUNT\_%' OR name LIKE 'CONTACT\_%' OR module IN ('ACCOUNT', 'CONTACT')
);
DELETE FROM "Permission" WHERE name LIKE 'ACCOUNT\_%' OR name LIKE 'CONTACT\_%' OR module IN ('ACCOUNT', 'CONTACT');

-- 5. Permission sets scoped to Account/Contact objects
DELETE FROM "PermissionSetRole" WHERE "permissionSetId" IN (
  SELECT id FROM "PermissionSet" WHERE "objectName" IN ('Account', 'Contact')
);
DELETE FROM "PermissionSet" WHERE "objectName" IN ('Account', 'Contact');

-- 6. ObjectDefinitions / FieldDefinitions / PageLayouts / permissions for Account/Contact
DELETE FROM "FieldPermission" WHERE "fieldId" IN (
  SELECT fd.id FROM "FieldDefinition" fd
  JOIN "ObjectDefinition" od ON fd."objectId" = od.id
  WHERE od.name IN ('Account', 'Contact')
);
DELETE FROM "ProfileFieldPermission" WHERE "fieldId" IN (
  SELECT fd.id FROM "FieldDefinition" fd
  JOIN "ObjectDefinition" od ON fd."objectId" = od.id
  WHERE od.name IN ('Account', 'Contact')
);
DELETE FROM "PermissionSetFieldPermission" WHERE "fieldId" IN (
  SELECT fd.id FROM "FieldDefinition" fd
  JOIN "ObjectDefinition" od ON fd."objectId" = od.id
  WHERE od.name IN ('Account', 'Contact')
);
DELETE FROM "ObjectPermission" WHERE "objectId" IN (
  SELECT id FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact')
);
DELETE FROM "ProfileObjectPermission" WHERE "objectId" IN (
  SELECT id FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact')
);
DELETE FROM "PermissionSetObjectPermission" WHERE "objectId" IN (
  SELECT id FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact')
);
DELETE FROM "FieldDefinition" WHERE "objectId" IN (
  SELECT id FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact')
);
DELETE FROM "PageLayout" WHERE "objectId" IN (
  SELECT id FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact')
);
DELETE FROM "ObjectSharingSetting" WHERE "objectId" IN (
  SELECT id FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact')
);
DELETE FROM "ObjectDefinition" WHERE name IN ('Account', 'Contact');

-- 7. Audit log cleanup for Account/Contact
DELETE FROM "AuditLog" WHERE "objectType" IN ('Account', 'Contact');

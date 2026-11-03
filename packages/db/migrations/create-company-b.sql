-- Create Company B for cross-tenant test
INSERT INTO "Tenant" (id, name, slug, "companyCode", "maxTotalUsers", "maxAdminUsers", "isActive", "createdAt", "updatedAt")
VALUES ('cb-test-tenant-001', 'Company B', 'company-b', 'COMP-B', 10, 5, true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create Admin profile for Company B
INSERT INTO "Profile" (id, name, "tenantId", "isAdmin", "isActive", "createdAt", "updatedAt")
VALUES ('cb-admin-profile-001', 'Admin', 'cb-test-tenant-001', true, true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create admin user for Company B
INSERT INTO "User" (id, email, "passwordHash", "firstName", "lastName", "isActive", "tenantId", "profileId", "createdAt", "updatedAt")
VALUES ('cb-admin-user-001', 'adminb@companyb.com', '$2a$12$LJ3m4ys3Lz0YBNOURq0Y3OjCfVlDd9Y8m1GqVl1qVl1qVl1qVl1q', 'Admin', 'CompanyB', true, 'cb-test-tenant-001', 'cb-admin-profile-001', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Create Admin role assignment for Company B admin
INSERT INTO "UserRole" (id, "userId", "roleId", "createdAt", "updatedAt")
SELECT 'cb-admin-role-001', 'cb-admin-user-001', id, NOW(), NOW()
FROM "Role" WHERE name = 'Company Admin' AND "tenantId" = 'cb-test-tenant-001'
LIMIT 1
ON CONFLICT DO NOTHING;

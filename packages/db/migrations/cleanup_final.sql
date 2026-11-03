DELETE FROM "AuditLog" WHERE "tenantId" IN (SELECT "id" FROM "Tenant" WHERE "companyCode" IN ('SEC-TEST','MASS'));
DELETE FROM "Tenant" WHERE "companyCode" IN ('SEC-TEST','MASS');

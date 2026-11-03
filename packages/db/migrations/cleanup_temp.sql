DELETE FROM "AuditLog" WHERE "tenantId" IN (SELECT "id" FROM "Tenant" WHERE "companyCode" = 'TEMP-DELETE');
DELETE FROM "Tenant" WHERE "companyCode" = 'TEMP-DELETE';

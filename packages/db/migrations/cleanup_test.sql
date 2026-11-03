DELETE FROM "UserRole" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE '%@test.com' AND "tenantId" = 'cmu3vys870000v046k6kjtd2w');
DELETE FROM "User" WHERE "email" LIKE '%@test.com' AND "tenantId" = 'cmu3vys870000v046k6kjtd2w';

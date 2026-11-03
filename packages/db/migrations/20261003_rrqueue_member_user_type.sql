-- Store member type on each Round Robin member rather than on the queue.
ALTER TABLE "RRQueueMember"
  DROP CONSTRAINT IF EXISTS "RRQueueMember_rrQueueId_userId_key";
ALTER TABLE "RRQueue"
  DROP CONSTRAINT IF EXISTS "RRQueue_tenant_project_userType_key";
ALTER TABLE "RRQueue"
  DROP CONSTRAINT IF EXISTS "RRQueue_tenantId_projectId_userType_key";
DROP INDEX IF EXISTS "RRQueue_tenant_project_userType_key";
DROP INDEX IF EXISTS "RRQueue_tenantId_projectId_userType_key";
DROP INDEX IF EXISTS "RRQueue_project_userType_active_idx";

UPDATE "RRQueue" q
SET "projectId" = p."id"
FROM "Project" p
WHERE q."projectId" IS NULL
  AND q."tenantId" = p."tenantId"
  AND (
    q."projectInterested"->>0 = p."id"
    OR LOWER(TRIM(q."projectInterested"->>0)) = LOWER(TRIM(p."name"))
  );

UPDATE "RRQueueMember" m
SET "userType" = CASE
  WHEN LOWER(TRIM(p."name")) IN ('pre sales', 'presales') THEN 'Pre Sales'
  WHEN LOWER(TRIM(p."name")) IN ('sales', 'sales executive') THEN 'Sales'
  WHEN LOWER(TRIM(p."name")) IN ('post sales', 'post-sales') THEN 'Post Sales'
  WHEN LOWER(TRIM(p."name")) = 'recovery' THEN 'Recovery'
  WHEN LOWER(TRIM(p."name")) = 'channel partner' THEN 'Channel Partner'
  WHEN LOWER(TRIM(p."name")) = 'svc' THEN 'SVC'
  ELSE m."userType"
END
FROM "User" u
JOIN "Profile" p ON p."id" = u."profileId"
WHERE m."userId" = u."id"
  AND u."tenantId" = m."tenantId";

ALTER TABLE "RRQueue" DROP COLUMN IF EXISTS "userType";
ALTER TABLE "RRQueueMember" ALTER COLUMN "userType" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "RRQueueMember_rrQueueId_userId_userType_key"
  ON "RRQueueMember"("rrQueueId", "userId", "userType");
CREATE INDEX IF NOT EXISTS "RRQueue_project_active_idx"
  ON "RRQueue"("tenantId", "projectId", "active");

ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "enquiryId" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "bookingId" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "comments" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "previousDisposition" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "cancelledReason" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "awaitedFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "isSystemCancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "testCheckbox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "sourceTaskId" TEXT;

UPDATE "FollowUp"
SET "status" = CASE
  WHEN "isCompleted" THEN 'COMPLETED'
  WHEN "isMissed" THEN 'MISSED'
  ELSE 'SCHEDULED'
END
WHERE "status" = 'SCHEDULED';

INSERT INTO "FollowUp" (
  "id", "followUpNumber", "tenantId", "leadId", "ownerId", "assignedToId",
  "title", "subject", "description", "comments", "dueDate", "completedAt",
  "isCompleted", "isMissed", "missedAt", "status", "cancelledReason", "sourceTaskId",
  "createdAt", "updatedAt"
)
SELECT
  'fu_' || t."id",
  'FU-TASK-' || t."id",
  t."tenantId",
  t."leadId",
  t."ownerId",
  t."ownerId",
  t."title",
  t."subject",
  COALESCE(NULLIF(t."description", ''), NULLIF(t."subject", ''), t."title"),
  concat_ws(
    E'\n',
    NULLIF(t."description", ''),
    CASE WHEN t."callType" IS NOT NULL THEN 'Call type: ' || t."callType" END,
    CASE WHEN t."callDisposition" IS NOT NULL THEN 'Call disposition: ' || t."callDisposition" END,
    CASE WHEN t."phone" IS NOT NULL THEN 'Phone: ' || t."phone" END,
    CASE WHEN t."email" IS NOT NULL THEN 'Email: ' || t."email" END,
    'Migrated from Task ' || t."id"
  ),
  COALESCE(t."dueDate", t."createdAt"),
  t."completedAt",
  t."status" = 'COMPLETED',
  t."status" NOT IN ('COMPLETED', 'CANCELLED') AND COALESCE(t."dueDate", t."createdAt") < NOW(),
  CASE
    WHEN t."status" NOT IN ('COMPLETED', 'CANCELLED') AND COALESCE(t."dueDate", t."createdAt") < NOW() THEN NOW()
    ELSE NULL
  END,
  CASE
    WHEN t."status" = 'COMPLETED' THEN 'COMPLETED'
    WHEN t."status" = 'CANCELLED' THEN 'CANCELLED'
    WHEN COALESCE(t."dueDate", t."createdAt") < NOW() THEN 'MISSED'
    ELSE 'SCHEDULED'
  END,
  CASE WHEN t."status" = 'CANCELLED' THEN COALESCE(NULLIF(t."description", ''), 'Cancelled') ELSE NULL END,
  t."id",
  t."createdAt",
  t."updatedAt"
FROM "Task" t
WHERE NOT EXISTS (
  SELECT 1 FROM "FollowUp" f WHERE f."tenantId" = t."tenantId" AND f."sourceTaskId" = t."id"
);

CREATE UNIQUE INDEX IF NOT EXISTS "FollowUp_tenantId_sourceTaskId_key" ON "FollowUp"("tenantId", "sourceTaskId");
CREATE INDEX IF NOT EXISTS "FollowUp_tenantId_assignedToId_idx" ON "FollowUp"("tenantId", "assignedToId");
CREATE INDEX IF NOT EXISTS "FollowUp_enquiryId_idx" ON "FollowUp"("enquiryId");
CREATE INDEX IF NOT EXISTS "FollowUp_bookingId_idx" ON "FollowUp"("bookingId");
CREATE INDEX IF NOT EXISTS "FollowUp_tenantId_status_idx" ON "FollowUp"("tenantId", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUp_enquiryId_fkey') THEN
    ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_enquiryId_fkey"
      FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUp_bookingId_fkey') THEN
    ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FollowUp_assignedToId_fkey') THEN
    ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey"
      FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DELETE FROM "LayoutAssignment" WHERE "objectName" IN ('Task', 'task');
DELETE FROM "ObjectDefinition" WHERE name = 'Task';

DROP TABLE IF EXISTS "Task";
DROP TYPE IF EXISTS "TaskStatus";
DROP TYPE IF EXISTS "TaskPriority";

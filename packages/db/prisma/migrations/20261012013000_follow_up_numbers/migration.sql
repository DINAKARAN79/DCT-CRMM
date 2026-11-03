ALTER TABLE "FollowUp"
ADD COLUMN "followUpNumber" TEXT;

WITH numbered_follow_ups AS (
  SELECT
    "id",
    "tenantId",
    ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt", "id") AS sequence_number
  FROM "FollowUp"
)
UPDATE "FollowUp" AS follow_up
SET "followUpNumber" = 'F-' || LPAD(numbered_follow_ups.sequence_number::TEXT, 6, '0')
FROM numbered_follow_ups
WHERE follow_up."id" = numbered_follow_ups."id";

ALTER TABLE "FollowUp"
ALTER COLUMN "followUpNumber" SET NOT NULL;

CREATE UNIQUE INDEX "FollowUp_tenantId_followUpNumber_key"
ON "FollowUp"("tenantId", "followUpNumber");

INSERT INTO "Sequence" ("id", "tenantId", "type", "nextValue")
SELECT
  MD5("tenantId" || ':FOLLOW_UP'),
  "tenantId",
  'FOLLOW_UP',
  MAX(SUBSTRING("followUpNumber" FROM '^F-([0-9]+)$')::INTEGER)
FROM "FollowUp"
GROUP BY "tenantId"
ON CONFLICT ("tenantId", "type")
DO UPDATE SET "nextValue" = GREATEST("Sequence"."nextValue", EXCLUDED."nextValue");

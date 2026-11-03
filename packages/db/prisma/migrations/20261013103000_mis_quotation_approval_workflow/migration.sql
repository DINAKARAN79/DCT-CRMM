ALTER TABLE "Quotation"
ADD COLUMN "createdById" TEXT,
ADD COLUMN "submittedById" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

UPDATE "Quotation" AS quotation
SET "createdById" = (
  SELECT audit."userId"
  FROM "AuditLog" AS audit
  WHERE audit."objectType" = 'Quotation'
    AND audit."objectId" = quotation."id"
    AND audit."action" = 'CREATE'
  ORDER BY audit."createdAt" ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "AuditLog" AS audit
  WHERE audit."objectType" = 'Quotation'
    AND audit."objectId" = quotation."id"
    AND audit."action" = 'CREATE'
);

UPDATE "Quotation" AS quotation
SET
  "submittedById" = COALESCE((
    SELECT audit."userId"
    FROM "AuditLog" AS audit
    WHERE audit."objectType" = 'Quotation'
      AND audit."objectId" = quotation."id"
      AND audit."newValues"->>'status' = 'SUBMITTED'
    ORDER BY audit."createdAt" DESC
    LIMIT 1
  ), quotation."createdById"),
  "submittedAt" = (
    SELECT audit."createdAt"
    FROM "AuditLog" AS audit
    WHERE audit."objectType" = 'Quotation'
      AND audit."objectId" = quotation."id"
      AND audit."newValues"->>'status' = 'SUBMITTED'
    ORDER BY audit."createdAt" DESC
    LIMIT 1
  )
WHERE quotation."status" = 'SUBMITTED';

UPDATE "Quotation" AS quotation
SET
  "reviewedById" = (
    SELECT approval."approverId"
    FROM "Approval" AS approval
    WHERE approval."quotationId" = quotation."id"
      AND approval."status"::text = quotation."status"::text
    ORDER BY approval."createdAt" DESC
    LIMIT 1
  ),
  "reviewedAt" = (
    SELECT approval."createdAt"
    FROM "Approval" AS approval
    WHERE approval."quotationId" = quotation."id"
      AND approval."status"::text = quotation."status"::text
    ORDER BY approval."createdAt" DESC
    LIMIT 1
  ),
  "rejectionReason" = CASE
    WHEN quotation."status" = 'REJECTED' THEN (
      SELECT approval."comments"
      FROM "Approval" AS approval
      WHERE approval."quotationId" = quotation."id"
        AND approval."status" = 'REJECTED'
      ORDER BY approval."createdAt" DESC
      LIMIT 1
    )
    ELSE NULL
  END
WHERE quotation."status" IN ('APPROVED', 'REJECTED');

CREATE INDEX "Quotation_createdById_idx" ON "Quotation"("createdById");
CREATE INDEX "Quotation_submittedById_idx" ON "Quotation"("submittedById");
CREATE INDEX "Quotation_reviewedById_idx" ON "Quotation"("reviewedById");

ALTER TABLE "Quotation"
ADD CONSTRAINT "Quotation_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Quotation"
ADD CONSTRAINT "Quotation_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Quotation"
ADD CONSTRAINT "Quotation_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Approval"
ADD CONSTRAINT "Approval_approverId_fkey"
FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

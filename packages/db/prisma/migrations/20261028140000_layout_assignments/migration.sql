CREATE TABLE IF NOT EXISTS "LayoutAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "objectName" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "recordTypeKey" TEXT NOT NULL DEFAULT 'MASTER',
    "layoutId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LayoutAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LayoutAssignment_tenantId_objectName_profileId_recordTypeKey_key"
    ON "LayoutAssignment"("tenantId", "objectName", "profileId", "recordTypeKey");

CREATE INDEX IF NOT EXISTS "LayoutAssignment_tenantId_objectName_idx"
    ON "LayoutAssignment"("tenantId", "objectName");

CREATE INDEX IF NOT EXISTS "LayoutAssignment_layoutId_idx"
    ON "LayoutAssignment"("layoutId");

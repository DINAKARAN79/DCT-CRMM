CREATE TABLE "PlatformReportDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformReportDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformDashboardDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformDashboardDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReportExecutionAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "tenantIds" JSONB,
    "resultCount" INTEGER,
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformReportExecutionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformReportDefinition_name_idx" ON "PlatformReportDefinition"("name");
CREATE INDEX "PlatformReportDefinition_isSystem_updatedAt_idx" ON "PlatformReportDefinition"("isSystem", "updatedAt");
CREATE INDEX "PlatformDashboardDefinition_name_idx" ON "PlatformDashboardDefinition"("name");
CREATE INDEX "PlatformDashboardDefinition_isSystem_updatedAt_idx" ON "PlatformDashboardDefinition"("isSystem", "updatedAt");
CREATE INDEX "PlatformReportExecutionAudit_actorId_createdAt_idx" ON "PlatformReportExecutionAudit"("actorId", "createdAt");
CREATE INDEX "PlatformReportExecutionAudit_targetType_targetId_createdAt_idx" ON "PlatformReportExecutionAudit"("targetType", "targetId", "createdAt");
CREATE INDEX "PlatformReportExecutionAudit_createdAt_idx" ON "PlatformReportExecutionAudit"("createdAt");

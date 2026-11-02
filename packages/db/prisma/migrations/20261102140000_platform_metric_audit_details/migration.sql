ALTER TABLE "PlatformReportExecutionAudit"
ADD COLUMN "filters" JSONB,
ADD COLUMN "durationMs" INTEGER;

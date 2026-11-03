-- Additive Salesforce Task support. Existing Task rows and DCT fields remain intact.
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "subject" TEXT,
  ADD COLUMN IF NOT EXISTS "salesforceStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "salesforcePriority" TEXT,
  ADD COLUMN IF NOT EXISTS "callDurationInSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "callObject" TEXT,
  ADD COLUMN IF NOT EXISTS "callDisposition" TEXT,
  ADD COLUMN IF NOT EXISTS "callType" TEXT,
  ADD COLUMN IF NOT EXISTS "isRecurrence" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "recurrenceInterval" INTEGER,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "isVisibleInSelfService" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "isReminderSet" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "recurrenceRegeneratedType" TEXT,
  ADD COLUMN IF NOT EXISTS "taskSubtype" TEXT,
  ADD COLUMN IF NOT EXISTS "taskType" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "lastModifiedById" TEXT,
  ADD COLUMN IF NOT EXISTS "bookingId" TEXT,
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "unitId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_lastModifiedById_fkey"
    FOREIGN KEY ("lastModifiedById") REFERENCES "User"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Task_tenant_dueDate_idx" ON "Task"("tenantId", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_siteVisitId_idx" ON "Task"("siteVisitId");
CREATE INDEX IF NOT EXISTS "Task_opportunityId_idx" ON "Task"("opportunityId");
CREATE INDEX IF NOT EXISTS "Task_bookingId_idx" ON "Task"("bookingId");
CREATE INDEX IF NOT EXISTS "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX IF NOT EXISTS "Task_unitId_idx" ON "Task"("unitId");
CREATE INDEX IF NOT EXISTS "Task_createdById_idx" ON "Task"("createdById");

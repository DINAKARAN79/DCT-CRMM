ALTER TABLE "telephony_settings" ADD COLUMN IF NOT EXISTS "clickToCallUrl" TEXT;
ALTER TABLE "telephony_settings" ADD COLUMN IF NOT EXISTS "noAuthRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "telephony_settings" ADD COLUMN IF NOT EXISTS "allowTestUrl" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "telephony_settings" ADD COLUMN IF NOT EXISTS "encryptedExtraHeaders" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'telephony_settings' AND column_name = 'baseUrl'
  ) THEN
    UPDATE "telephony_settings"
    SET "clickToCallUrl" = CASE
      WHEN "baseUrl" IS NULL OR btrim("baseUrl") = '' THEN 'https://bizcall.cxteletech.com/api/dialer/click2call'
      WHEN regexp_replace(rtrim("baseUrl"), '/+$', '') ~* '/api/dialer/click2call$' THEN regexp_replace(rtrim("baseUrl"), '/+$', '')
      ELSE regexp_replace(rtrim("baseUrl"), '/+$', '') || '/api/dialer/click2call'
    END
    WHERE "clickToCallUrl" IS NULL OR btrim("clickToCallUrl") = '';
  END IF;
END $$;

ALTER TABLE "telephony_settings" ALTER COLUMN "clickToCallUrl" SET DEFAULT 'https://bizcall.cxteletech.com/api/dialer/click2call';
ALTER TABLE "telephony_settings" ALTER COLUMN "clickToCallUrl" SET NOT NULL;
ALTER TABLE "telephony_settings" DROP COLUMN IF EXISTS "baseUrl";

CREATE TABLE IF NOT EXISTS "telephony_request_logs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leadId" TEXT,
  "maskedNumber" TEXT,
  "step" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "httpStatus" INTEGER,
  "durationMs" INTEGER,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telephony_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "telephony_request_logs_tenantId_createdAt_idx"
  ON "telephony_request_logs"("tenantId", "createdAt");

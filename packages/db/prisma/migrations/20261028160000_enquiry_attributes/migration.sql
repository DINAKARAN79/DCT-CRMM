ALTER TABLE "Enquiry" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN IF NOT EXISTS "attributes" JSONB NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Enquiry_ownerId_fkey') THEN
    ALTER TABLE "Enquiry"
      ADD CONSTRAINT "Enquiry_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Enquiry_ownerId_idx" ON "Enquiry"("ownerId");

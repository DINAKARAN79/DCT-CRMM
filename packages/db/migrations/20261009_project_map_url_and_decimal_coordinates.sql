ALTER TABLE "Project"
  ALTER COLUMN "latitude" TYPE DECIMAL(10, 7) USING "latitude"::DECIMAL(10, 7),
  ALTER COLUMN "longitude" TYPE DECIMAL(10, 7) USING "longitude"::DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS "map_url" TEXT;

UPDATE "Project"
SET "map_url" = 'https://www.google.com/maps?q=' || "latitude" || ',' || "longitude"
WHERE "latitude" IS NOT NULL
  AND "longitude" IS NOT NULL;

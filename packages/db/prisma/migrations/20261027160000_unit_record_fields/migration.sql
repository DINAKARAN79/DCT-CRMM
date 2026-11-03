-- Additive Unit record fields. Existing inventory columns, quotations, bookings, and layouts stay in place.

ALTER TABLE "Unit" ADD COLUMN "unitCode" TEXT;
ALTER TABLE "Unit" ADD COLUMN "buildupArea" INTEGER;
ALTER TABLE "Unit" ADD COLUMN "allowedDiscount" VARCHAR(25);
ALTER TABLE "Unit" ADD COLUMN "minimumBookingAmount" INTEGER;
ALTER TABLE "Unit" ADD COLUMN "msp" VARCHAR(255);
ALTER TABLE "Unit" ADD COLUMN "plc" VARCHAR(255);
ALTER TABLE "Unit" ADD COLUMN "nonPlc" VARCHAR(255);
ALTER TABLE "Unit" ADD COLUMN "registrationDate" TIMESTAMP(3);
ALTER TABLE "Unit" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "createdById" TEXT;
ALTER TABLE "Unit" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "Unit" ADD COLUMN "customerLeadId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "bookingLeadId" TEXT;
ALTER TABLE "Unit" ADD COLUMN "opportunityLeadId" TEXT;

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt" ASC, id ASC) AS n
  FROM "Unit"
)
UPDATE "Unit" AS unit
SET "unitCode" = 'U-' || LPAD(numbered.n::text, 4, '0')
FROM numbered
WHERE unit.id = numbered.id
  AND unit."unitCode" IS NULL;

CREATE UNIQUE INDEX "Unit_tenantId_unitCode_key" ON "Unit"("tenantId", "unitCode");
CREATE INDEX "Unit_ownerId_idx" ON "Unit"("ownerId");
CREATE INDEX "Unit_createdById_idx" ON "Unit"("createdById");
CREATE INDEX "Unit_updatedById_idx" ON "Unit"("updatedById");
CREATE INDEX "Unit_customerLeadId_idx" ON "Unit"("customerLeadId");
CREATE INDEX "Unit_bookingLeadId_idx" ON "Unit"("bookingLeadId");
CREATE INDEX "Unit_opportunityLeadId_idx" ON "Unit"("opportunityLeadId");

ALTER TABLE "Unit" ADD CONSTRAINT "Unit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_customerLeadId_fkey" FOREIGN KEY ("customerLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_bookingLeadId_fkey" FOREIGN KEY ("bookingLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_opportunityLeadId_fkey" FOREIGN KEY ("opportunityLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

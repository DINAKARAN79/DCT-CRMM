UPDATE "Lead" SET "status" = 'PROSPECT' WHERE "status" IN ('SALES', 'OPPORTUNITY');
UPDATE "Lead" SET "status" = 'BOOKED' WHERE "status" IN ('QUOTATION', 'APPROVAL', 'BOOKING');
UPDATE "Lead" SET "status" = 'NEW' WHERE "status" = 'DUPLICATE';

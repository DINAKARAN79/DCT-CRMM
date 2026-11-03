ALTER TABLE "Quotation"
ADD COLUMN "paymentPlan" TEXT;

ALTER TABLE "Opportunity"
ADD COLUMN "notes" TEXT;

ALTER TABLE "Payment"
ADD COLUMN "verifiedById" TEXT,
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectedById" TEXT,
ADD COLUMN "rejectionReason" TEXT;

CREATE TABLE "QuotationInstallment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "percentage" DECIMAL(7,4),
    "scheduledAmount" DECIMAL(14,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuotationInstallment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "ReceiptStatus" AS ENUM ('ISSUED', 'CANCELLED');

CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "quotationId" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerNameSnapshot" TEXT NOT NULL,
    "projectNameSnapshot" TEXT NOT NULL,
    "unitNumberSnapshot" TEXT NOT NULL,
    "paymentReferenceSnapshot" TEXT,
    "detailsSnapshot" JSONB NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedById" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuotationInstallment_tenantId_bookingId_sequenceNumber_key"
ON "QuotationInstallment"("tenantId", "bookingId", "sequenceNumber");
CREATE INDEX "QuotationInstallment_tenantId_quotationId_idx"
ON "QuotationInstallment"("tenantId", "quotationId");
CREATE INDEX "QuotationInstallment_tenantId_bookingId_dueDate_idx"
ON "QuotationInstallment"("tenantId", "bookingId", "dueDate");

CREATE UNIQUE INDEX "PaymentAllocation_paymentId_installmentId_key"
ON "PaymentAllocation"("paymentId", "installmentId");
CREATE INDEX "PaymentAllocation_tenantId_paymentId_idx"
ON "PaymentAllocation"("tenantId", "paymentId");
CREATE INDEX "PaymentAllocation_tenantId_installmentId_idx"
ON "PaymentAllocation"("tenantId", "installmentId");

CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");
CREATE UNIQUE INDEX "Receipt_tenantId_receiptNumber_key"
ON "Receipt"("tenantId", "receiptNumber");
CREATE INDEX "Receipt_tenantId_receiptDate_idx"
ON "Receipt"("tenantId", "receiptDate");
CREATE INDEX "Receipt_tenantId_status_receiptDate_idx"
ON "Receipt"("tenantId", "status", "receiptDate");
CREATE INDEX "Receipt_tenantId_bookingId_idx"
ON "Receipt"("tenantId", "bookingId");
CREATE INDEX "Payment_verifiedById_idx" ON "Payment"("verifiedById");

ALTER TABLE "QuotationInstallment"
ADD CONSTRAINT "QuotationInstallment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "QuotationInstallment_quotationId_fkey"
FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "QuotationInstallment_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation"
ADD CONSTRAINT "PaymentAllocation_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentAllocation_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentAllocation_installmentId_fkey"
FOREIGN KEY ("installmentId") REFERENCES "QuotationInstallment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "PaymentAllocation_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Receipt"
ADD CONSTRAINT "Receipt_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Receipt_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Receipt_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Receipt_quotationId_fkey"
FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Receipt_issuedById_fkey"
FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Receipt_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_verifiedById_fkey"
FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "Payment_rejectedById_fkey"
FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

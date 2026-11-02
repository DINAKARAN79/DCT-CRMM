CREATE INDEX "Tenant_createdAt_idx" ON "Tenant"("createdAt");
CREATE INDEX "User_tenantId_createdAt_idx" ON "User"("tenantId", "createdAt");
CREATE INDEX "SiteVisit_tenantId_createdAt_idx" ON "SiteVisit"("tenantId", "createdAt");
CREATE INDEX "Project_tenantId_createdAt_idx" ON "Project"("tenantId", "createdAt");
CREATE INDEX "Unit_tenantId_createdAt_idx" ON "Unit"("tenantId", "createdAt");
CREATE INDEX "Quotation_tenantId_createdAt_idx" ON "Quotation"("tenantId", "createdAt");
CREATE INDEX "Booking_tenantId_createdAt_idx" ON "Booking"("tenantId", "createdAt");
CREATE INDEX "Receipt_tenantId_createdAt_idx" ON "Receipt"("tenantId", "createdAt");

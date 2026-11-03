CREATE TABLE "SavedListView" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiName" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedListView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedListViewShare" (
    "id" TEXT NOT NULL,
    "listViewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "SavedListViewShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListViewPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "viewKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListViewPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListViewPin" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "viewKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListViewPin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ListViewRecent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "viewKey" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListViewRecent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmRecordView" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmRecordView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedListView_tenantId_module_apiName_key" ON "SavedListView"("tenantId", "module", "apiName");
CREATE INDEX "SavedListView_tenantId_module_idx" ON "SavedListView"("tenantId", "module");
CREATE UNIQUE INDEX "SavedListViewShare_listViewId_userId_key" ON "SavedListViewShare"("listViewId", "userId");
CREATE UNIQUE INDEX "ListViewPreference_tenantId_userId_module_key" ON "ListViewPreference"("tenantId", "userId", "module");
CREATE UNIQUE INDEX "ListViewPin_tenantId_userId_module_viewKey_key" ON "ListViewPin"("tenantId", "userId", "module", "viewKey");
CREATE UNIQUE INDEX "ListViewRecent_tenantId_userId_module_viewKey_key" ON "ListViewRecent"("tenantId", "userId", "module", "viewKey");
CREATE UNIQUE INDEX "CrmRecordView_tenantId_userId_module_recordId_key" ON "CrmRecordView"("tenantId", "userId", "module", "recordId");
CREATE INDEX "CrmRecordView_tenantId_userId_module_viewedAt_idx" ON "CrmRecordView"("tenantId", "userId", "module", "viewedAt");

ALTER TABLE "SavedListViewShare" ADD CONSTRAINT "SavedListViewShare_listViewId_fkey" FOREIGN KEY ("listViewId") REFERENCES "SavedListView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

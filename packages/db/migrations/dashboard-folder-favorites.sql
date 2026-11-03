CREATE TABLE IF NOT EXISTS "DashboardFolderFavorite" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardFolderFavorite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DashboardFolderFavorite_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DashboardFolderFavorite_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "DashboardFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DashboardFolderFavorite_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardFolderFavorite_folderId_userId_key"
  ON "DashboardFolderFavorite"("folderId", "userId");
CREATE INDEX IF NOT EXISTS "DashboardFolderFavorite_tenantId_userId_idx"
  ON "DashboardFolderFavorite"("tenantId", "userId");
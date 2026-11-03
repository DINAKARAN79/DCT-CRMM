CREATE TABLE IF NOT EXISTS "DashboardProfileShare" (
  "id" TEXT NOT NULL,
  "dashboardId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  CONSTRAINT "DashboardProfileShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DashboardProfileShare_dashboardId_fkey"
    FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DashboardProfileShare_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardProfileShare_dashboardId_profileId_key"
  ON "DashboardProfileShare"("dashboardId", "profileId");
CREATE INDEX IF NOT EXISTS "DashboardProfileShare_profileId_idx"
  ON "DashboardProfileShare"("profileId");
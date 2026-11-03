-- Dashboard refresh is manual while editing unless explicitly enabled.
ALTER TABLE "Dashboard"
  ADD COLUMN IF NOT EXISTS "autoRefreshWhileEditing" BOOLEAN NOT NULL DEFAULT FALSE;
